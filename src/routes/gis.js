
const express    = require('express');
const pool       = require('../config/db');
const scoringApi = require('../services/scoringApi');

const router = express.Router();

// Nurseries must be at least this far apart (matches Python scoring service)
const MIN_SPACING_M = 2;

//  Nursery type metadata 

const NURSERY_TYPE_INFO = {
  table: {
    shape:           'rectangle',
    required_fields: ['width_m', 'length_m'],
    optional_fields: ['height_m'],
    description:     'Flat platform — enter width and length (height optional).',
  },
  tree: {
    shape:           'circle',
    required_fields: ['radius_m'],
    optional_fields: ['height_m'],
    description:     'Vertical tree structure — enter radius.',
  },
  drum: {
    shape:           'circle',
    required_fields: ['radius_m'],
    optional_fields: ['height_m'],
    description:     'Drum / rope nursery — enter radius.',
  },
  reef_ball: {
    shape:           'circle',
    required_fields: ['radius_m'],
    optional_fields: ['height_m'],
    description:     'Reef ball module — enter radius.',
  },
};

const VALID_TYPES = Object.keys(NURSERY_TYPE_INFO);

// Shared SQL fragment — converts PostGIS geometry to WGS84 lon/lat
const POINT_SELECT = `
  SELECT
    id, fid,
    ST_X(ST_Transform(geom, 4326)) AS longitude,
    ST_Y(ST_Transform(geom, 4326)) AS latitude,
    feature_x, feature_y,
    dist_nursery_m, space_area_m2, dist_shore_m,
    depth_band, suitability_score, is_available, nursery_disttype
  FROM candidate_points
`;

//  GET /nursery-types

router.get('/nursery-types', (req, res) => {
  res.json({ nursery_types: NURSERY_TYPE_INFO });
});

//  GET /candidate-points 

router.get('/candidate-points', async (req, res) => {
  try {
    const { rows } = await pool.query(
      POINT_SELECT + `WHERE is_available = true ORDER BY suitability_score DESC`
    );
    res.json({ count: rows.length, points: rows });
  } catch (err) {
    console.error('GET /api/gis/candidate-points:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//  GET /top-locations?limit=10 

router.get('/top-locations', async (req, res) => {
  const limit = Math.max(1, Math.min(300, parseInt(req.query.limit) || 10));
  try {
    const { rows } = await pool.query(
      POINT_SELECT + `WHERE is_available = true ORDER BY suitability_score DESC LIMIT $1`,
      [limit]
    );
    res.json({ count: rows.length, limit, points: rows });
  } catch (err) {
    console.error('GET /api/gis/top-locations:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//  POST /top-locations-by-nursery 
// Calls the Python scoring service to apply dimension-aware weights

router.post('/top-locations-by-nursery', async (req, res) => {
  const { nursery_type, width_m, length_m, radius_m, height_m } = req.body;
  const limit = Math.max(1, Math.min(300, parseInt(req.body.limit) || 10));

  if (!VALID_TYPES.includes(nursery_type)) {
    return res.status(422).json({
      error: `nursery_type must be one of: ${VALID_TYPES.join(', ')}`,
    });
  }

  try {
    // 1. Ask scoring service to calculate required floor-plan area
    const requiredArea = await scoringApi.calculateArea({
      nurseryType: nursery_type,
      widthM:  width_m,
      lengthM: length_m,
      radiusM: radius_m,
    });

    // 2. Fetch all available points from DB
    const { rows } = await pool.query(POINT_SELECT + `WHERE is_available = true`);

    // 3. Ask scoring service to rank with dimension-aware weights
    const top = await scoringApi.scorePoints(rows, { requiredArea, limit });

    res.json({
      nursery_type,
      required_area_m2: Math.round(requiredArea * 10000) / 10000,
      dimensions:   { width_m, length_m, radius_m, height_m },
      weights_used: 'dimension-aware (space = 40%)',
      count:        top.length,
      limit,
      points:       top,
    });
  } catch (err) {
    // Surface 422 errors from scoring service (bad dimensions)
    if (err.response?.status === 422) {
      return res.status(422).json({ error: err.response.data?.detail || err.message });
    }
    console.error('POST /api/gis/top-locations-by-nursery:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//  GET /nurseries 

router.get('/nurseries', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, type, area_m2,
        width_m, length_m, radius_m, height_m,
        ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson,
        created_at
      FROM nurseries
      ORDER BY created_at DESC
    `);
    const nurseries = rows.map(r => ({
      id:         r.id,
      type:       r.type,
      area_m2:    r.area_m2,
      width_m:    r.width_m,
      length_m:   r.length_m,
      radius_m:   r.radius_m,
      height_m:   r.height_m,
      geometry:   r.geojson ? JSON.parse(r.geojson) : null,
      created_at: r.created_at,
    }));
    res.json({ count: nurseries.length, nurseries });
  } catch (err) {
    console.error('GET /api/gis/nurseries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

//  POST /nurseries 
// Adds a nursery, then asks the scoring service to recalculate all point scores

router.post('/nurseries', async (req, res) => {
  const { type, longitude, latitude, width_m, length_m, radius_m, height_m } = req.body;

  if (!type || longitude == null || latitude == null) {
    return res.status(422).json({ error: 'Required fields: type, longitude, latitude' });
  }
  if (!VALID_TYPES.includes(type)) {
    return res.status(422).json({
      error: `type must be one of: ${VALID_TYPES.join(', ')}`,
    });
  }

  // Calculate nursery area via scoring service
  let areaMq;
  try {
    areaMq = await scoringApi.calculateArea({
      nurseryType: type,
      widthM:  width_m,
      lengthM: length_m,
      radiusM: radius_m,
    });
  } catch (err) {
    if (err.response?.status === 422) {
      return res.status(422).json({ error: err.response.data?.detail || err.message });
    }
    return res.status(500).json({ error: err.message });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert nursery geometry into PostGIS
    let insertSQL, insertParams;

    if (type === 'table') {
      const hw = width_m  / 2;
      const hl = length_m / 2;
      insertParams = [longitude, latitude, type, areaMq, hw, hl, width_m, length_m, height_m];
      insertSQL = `
        WITH centre AS (
          SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 32644) AS pt
        )
        INSERT INTO nurseries (type, area_m2, geom, width_m, length_m, height_m, created_at)
        SELECT $3, $4,
          ST_MakeEnvelope(ST_X(pt)-$5, ST_Y(pt)-$6, ST_X(pt)+$5, ST_Y(pt)+$6, 32644),
          $7, $8, $9, NOW()
        FROM centre
        RETURNING id, type, area_m2, width_m, length_m, height_m, created_at,
                  ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson
      `;
    } else {
      insertSQL = `
        WITH centre AS (
          SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 32644) AS pt
        )
        INSERT INTO nurseries (type, area_m2, geom, radius_m, height_m, created_at)
        SELECT $3, $4, ST_Buffer(pt, $5), $5, $6, NOW()
        FROM centre
        RETURNING id, type, area_m2, radius_m, height_m, created_at,
                  ST_AsGeoJSON(ST_Transform(geom, 4326)) AS geojson
      `;
      insertParams = [longitude, latitude, type, areaMq, radius_m, height_m];
    }

    const { rows: [newRow] } = await client.query(insertSQL, insertParams);

    // Recalculate dist_nursery_m for all points using PostGIS
    await client.query(`
      UPDATE candidate_points cp
      SET dist_nursery_m = (SELECT MIN(ST_Distance(cp.geom, n.geom)) FROM nurseries n)
    `);

    // Mark points too close to any nursery as unavailable
    await client.query(`
      UPDATE candidate_points
      SET is_available = CASE WHEN dist_nursery_m <= $1 THEN false ELSE true END
    `, [MIN_SPACING_M]);

    // Fetch all points and send to scoring service for recalculation
    const { rows: allPoints } = await client.query(`
      SELECT fid, dist_nursery_m, space_area_m2, dist_shore_m, depth_band
      FROM candidate_points
      WHERE dist_nursery_m IS NOT NULL
        AND space_area_m2  IS NOT NULL
        AND dist_shore_m   IS NOT NULL
    `);

    const scoreList = await scoringApi.recalculateAllScores(allPoints);
    // scoreList = [{ fid, suitability_score }, ...]

    if (scoreList.length > 0) {
      const fids   = scoreList.map(s => s.fid);
      const scores = scoreList.map(s => s.suitability_score);
      await client.query(`
        UPDATE candidate_points AS cp
        SET suitability_score = v.score
        FROM (
          SELECT unnest($1::bigint[]) AS fid,
                 unnest($2::float[])  AS score
        ) AS v
        WHERE cp.fid = v.fid
      `, [fids, scores]);
    }

    await client.query('COMMIT');

    // Return new nursery + updated top 5 locations
    const { rows: top5 } = await pool.query(
      POINT_SELECT + `WHERE is_available = true ORDER BY suitability_score DESC LIMIT 5`
    );

    res.status(201).json({
      message: 'Nursery added and scores recalculated.',
      nursery: {
        id:         newRow.id,
        type:       newRow.type,
        area_m2:    newRow.area_m2,
        width_m:    newRow.width_m   ?? null,
        length_m:   newRow.length_m  ?? null,
        radius_m:   newRow.radius_m  ?? null,
        height_m:   newRow.height_m  ?? null,
        geometry:   newRow.geojson ? JSON.parse(newRow.geojson) : null,
        created_at: newRow.created_at,
      },
      top5_updated_locations: top5,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/gis/nurseries:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

//  GET /stats 

router.get('/stats', async (req, res) => {
  try {
    const { rows: [s] } = await pool.query(`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE is_available = true)      AS available,
        COUNT(*) FILTER (WHERE is_available = false)     AS unavailable,
        ROUND(AVG(suitability_score)::numeric, 4)        AS avg_score,
        ROUND(MAX(suitability_score)::numeric, 4)        AS max_score,
        ROUND(MIN(suitability_score)::numeric, 4)        AS min_score,
        COUNT(*) FILTER (WHERE depth_band = '0-3m')      AS band_0_3m,
        COUNT(*) FILTER (WHERE depth_band = '3-7m')      AS band_3_7m,
        COUNT(*) FILTER (WHERE depth_band = '7-10m')     AS band_7_10m
      FROM candidate_points
    `);
    res.json({
      total:       parseInt(s.total),
      available:   parseInt(s.available),
      unavailable: parseInt(s.unavailable),
      scores: {
        avg: parseFloat(s.avg_score || 0),
        max: parseFloat(s.max_score || 0),
        min: parseFloat(s.min_score || 0),
      },
      depth_bands: {
        '0-3m':  parseInt(s.band_0_3m),
        '3-7m':  parseInt(s.band_3_7m),
        '7-10m': parseInt(s.band_7_10m),
      },
    });
  } catch (err) {
    console.error('GET /api/gis/stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
