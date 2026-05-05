
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

const VALID_TYPES = new Set(Object.keys(NURSERY_TYPE_INFO));

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
// Supports ?available=true|false (default: true) and ?limit=N

router.get('/candidate-points', async (req, res) => {
  try {
    const available = req.query.available !== 'false';
    const limit = req.query.limit
      ? Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 120))
      : 120;

    const { rows } = await pool.query(
      POINT_SELECT + `WHERE is_available = $2 AND location_id = $1 ORDER BY suitability_score DESC LIMIT $3`,
      [req.locationId, available, limit]
    );
    res.json({ count: rows.length, points: rows });
  } catch (err) {
    console.error('GET /api/gis/candidate-points:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  GET /top-locations?limit=10

router.get('/top-locations', async (req, res) => {
  const limit = Math.max(1, Math.min(300, parseInt(req.query.limit, 10) || 10));
  try {
    const { rows } = await pool.query(
      POINT_SELECT + `WHERE is_available = true AND location_id = $1 ORDER BY suitability_score DESC LIMIT $2`,
      [req.locationId, limit]
    );
    res.json({ count: rows.length, limit, points: rows });
  } catch (err) {
    console.error('GET /api/gis/top-locations:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  POST /top-locations-by-nursery
// Calls the Python scoring service to apply dimension-aware weights

router.post('/top-locations-by-nursery', async (req, res) => {
  const { nursery_type, width_m, length_m, radius_m, height_m } = req.body;
  const limit = Math.max(1, Math.min(300, parseInt(req.body.limit, 10) || 10));

  if (!VALID_TYPES.has(nursery_type)) {
    return res.status(422).json({
      error: `nursery_type must be one of: ${[...VALID_TYPES].join(', ')}`,
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

    // 2. Fetch all available points from DB for this location
    const { rows } = await pool.query(
      POINT_SELECT + `WHERE is_available = true AND location_id = $1`,
      [req.locationId]
    );

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
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  GET /nurseries

router.get('/nurseries', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        id, type, area_m2,
        width_m, length_m, radius_m, height_m,
        name, coral_species,
        date_placement,
        depth_m, notes,
        ST_X(ST_Centroid(ST_Transform(geom, 4326))) AS longitude,
        ST_Y(ST_Centroid(ST_Transform(geom, 4326))) AS latitude,
        created_at
      FROM nurseries
      WHERE location_id = $1
      ORDER BY created_at DESC
    `, [req.locationId]);
    const nurseries = rows.map(r => ({
      id:             r.id,
      type:           r.type,
      area_m2:        r.area_m2,
      width_m:        r.width_m,
      length_m:       r.length_m,
      radius_m:       r.radius_m,
      height_m:       r.height_m,
      name:           r.name           ?? null,
      coral_species:  r.coral_species  ?? null,
      date_placement: r.date_placement ?? null,
      depth_m:        r.depth_m        ?? null,
      notes:          r.notes          ?? null,
      latitude:       r.latitude  !== null ? parseFloat(r.latitude)  : null,
      longitude:      r.longitude !== null ? parseFloat(r.longitude) : null,
      created_at:     r.created_at,
    }));
    res.json({ count: nurseries.length, nurseries });
  } catch (err) {
    console.error('GET /api/gis/nurseries:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  POST /nurseries
// Adds a nursery, then asks the scoring service to recalculate all point scores

router.post('/nurseries', async (req, res) => {
  const {
    type, longitude, latitude,
    width_m, length_m, radius_m, height_m,
    name, coral_species, date_placement, depth_m, notes,
  } = req.body;

  if (!type || longitude === null || longitude === undefined || latitude === null || latitude === undefined) {
    return res.status(422).json({ error: 'Required fields: type, longitude, latitude' });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(422).json({
      error: `type must be one of: ${[...VALID_TYPES].join(', ')}`,
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
    return res.status(500).json({ error: 'Internal server error.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert nursery geometry into PostGIS
    let insertSQL, insertParams;

    // Common new-field params shared by both INSERT branches
    const metaParams = [
      name          || null,
      coral_species || null,
      date_placement|| null,
      depth_m       !== null && depth_m !== undefined ? parseFloat(depth_m) : null,
      notes         || null,
      req.locationId,
    ];

    if (type === 'table') {
      const hw = width_m  / 2;
      const hl = length_m / 2;
      // $1=lon $2=lat $3=type $4=area $5=hw $6=hl $7=w $8=l $9=h
      // $10=name $11=species $12=date $13=depth $14=notes $15=location_id
      insertParams = [longitude, latitude, type, areaMq, hw, hl, width_m, length_m, height_m, ...metaParams];
      insertSQL = `
        WITH centre AS (
          SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 32644) AS pt
        )
        INSERT INTO nurseries
          (type, area_m2, geom, width_m, length_m, height_m,
           name, coral_species, date_placement, depth_m, notes, location_id, created_at)
        SELECT $3, $4,
          ST_MakeEnvelope(ST_X(pt)-$5, ST_Y(pt)-$6, ST_X(pt)+$5, ST_Y(pt)+$6, 32644),
          $7, $8, $9, $10, $11, $12::date, $13, $14, $15, NOW()
        FROM centre
        RETURNING
          id, type, area_m2, width_m, length_m, height_m,
          name, coral_species,
          date_placement,
          depth_m, notes, created_at,
          ST_X(ST_Centroid(ST_Transform(geom, 4326))) AS longitude,
          ST_Y(ST_Centroid(ST_Transform(geom, 4326))) AS latitude
      `;
    } else {
      // $1=lon $2=lat $3=type $4=area $5=radius $6=height
      // $7=name $8=species $9=date $10=depth $11=notes $12=location_id
      insertParams = [longitude, latitude, type, areaMq, radius_m, height_m, ...metaParams];
      insertSQL = `
        WITH centre AS (
          SELECT ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 4326), 32644) AS pt
        )
        INSERT INTO nurseries
          (type, area_m2, geom, radius_m, height_m,
           name, coral_species, date_placement, depth_m, notes, location_id, created_at)
        SELECT $3, $4, ST_Buffer(pt, $5), $5, $6, $7, $8, $9::date, $10, $11, $12, NOW()
        FROM centre
        RETURNING
          id, type, area_m2, radius_m, height_m,
          name, coral_species,
          date_placement,
          depth_m, notes, created_at,
          ST_X(ST_Centroid(ST_Transform(geom, 4326))) AS longitude,
          ST_Y(ST_Centroid(ST_Transform(geom, 4326))) AS latitude
      `;
    }

    const { rows: [newRow] } = await client.query(insertSQL, insertParams);

    // Recalculate dist_nursery_m for all points in this location using PostGIS
    await client.query(`
      UPDATE candidate_points cp
      SET dist_nursery_m = (
        SELECT MIN(ST_Distance(cp.geom, n.geom))
        FROM nurseries n
        WHERE n.location_id = $1
      )
      WHERE cp.location_id = $1
    `, [req.locationId]);

    // Mark points too close to any nursery as unavailable
    await client.query(`
      UPDATE candidate_points
      SET is_available = CASE WHEN dist_nursery_m <= $1 THEN false ELSE true END
      WHERE location_id = $2
    `, [MIN_SPACING_M, req.locationId]);

    // Fetch all points for this location and send to scoring service for recalculation
    const { rows: allPoints } = await client.query(`
      SELECT fid, dist_nursery_m, space_area_m2, dist_shore_m, depth_band
      FROM candidate_points
      WHERE location_id = $1
        AND dist_nursery_m IS NOT NULL
        AND space_area_m2  IS NOT NULL
        AND dist_shore_m   IS NOT NULL
    `, [req.locationId]);

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
        WHERE cp.fid = v.fid AND cp.location_id = $3
      `, [fids, scores, req.locationId]);
    }

    await client.query('COMMIT');

    // Return new nursery + updated top 5 locations
    const { rows: top5 } = await pool.query(
      POINT_SELECT + `WHERE is_available = true AND location_id = $1 ORDER BY suitability_score DESC LIMIT 5`,
      [req.locationId]
    );

    res.status(201).json({
      message: 'Nursery added and scores recalculated.',
      nursery: {
        id:             newRow.id,
        type:           newRow.type,
        area_m2:        newRow.area_m2,
        width_m:        newRow.width_m        ?? null,
        length_m:       newRow.length_m       ?? null,
        radius_m:       newRow.radius_m       ?? null,
        height_m:       newRow.height_m       ?? null,
        name:           newRow.name           ?? null,
        coral_species:  newRow.coral_species  ?? null,
        date_placement: newRow.date_placement ?? null,
        depth_m:        newRow.depth_m        ?? null,
        notes:          newRow.notes          ?? null,
        latitude:       newRow.latitude  !== null ? parseFloat(newRow.latitude)  : null,
        longitude:      newRow.longitude !== null ? parseFloat(newRow.longitude) : null,
        created_at:     newRow.created_at,
      },
      top5_updated_locations: top5,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/gis/nurseries:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
});

//  DELETE /nurseries/:id
// Deletes a nursery and recalculates candidate-point availability for this location.

router.delete('/nurseries/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(422).json({ error: 'Invalid nursery id.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete — guard by location_id so users can't delete another site's nursery
    const { rowCount } = await client.query(
      `DELETE FROM nurseries WHERE id = $1 AND location_id = $2`,
      [id, req.locationId]
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Nursery not found.' });
    }

    // Recalculate nearest-nursery distance for all points in this location
    await client.query(`
      UPDATE candidate_points cp
      SET dist_nursery_m = (
        SELECT MIN(ST_Distance(cp.geom, n.geom))
        FROM nurseries n
        WHERE n.location_id = $1
      )
      WHERE cp.location_id = $1
    `, [req.locationId]);

    // Re-open any points that are now far enough from all remaining nurseries
    await client.query(`
      UPDATE candidate_points
      SET is_available = CASE
        WHEN dist_nursery_m IS NULL OR dist_nursery_m > $1 THEN true
        ELSE false
      END
      WHERE location_id = $2
    `, [MIN_SPACING_M, req.locationId]);

    await client.query('COMMIT');
    res.json({ message: 'Nursery deleted.', id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('DELETE /api/gis/nurseries/:id:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    client.release();
  }
});

//  PATCH /nurseries/:id
// Updates editable metadata/dimension fields for an existing nursery.

router.patch('/nurseries/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(422).json({ error: 'Invalid nursery id.' });
  }

  const { coral_species, notes, depth_m, height_m, width_m, length_m, radius_m } = req.body;

  const sets   = [];
  const params = [];
  const add    = (col, val) => { sets.push(`${col} = $${params.length + 1}`); params.push(val); };

  if (coral_species !== undefined) add('coral_species', coral_species);
  if (notes         !== undefined) add('notes',         notes);
  if (depth_m       !== undefined) add('depth_m',       depth_m);
  if (height_m      !== undefined) add('height_m',      height_m);
  if (width_m       !== undefined) add('width_m',       width_m);
  if (length_m      !== undefined) add('length_m',      length_m);
  if (radius_m      !== undefined) add('radius_m',      radius_m);

  if (sets.length === 0) {
    return res.status(422).json({ error: 'No fields to update.' });
  }
  params.push(id);
  params.push(req.locationId);

  try {
    const { rows } = await pool.query(
      `UPDATE nurseries SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND location_id = $${params.length} RETURNING id`,
      params
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Nursery not found.' });
    }
    res.json({ message: 'Nursery updated.', id: rows[0].id });
  } catch (err) {
    console.error('PATCH /api/gis/nurseries/:id:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

//  GET /restoration-zone
// Returns the stored restoration zone polygon as an array of {latitude, longitude} points + area.

router.get('/restoration-zone', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, label, area_m2, ST_AsGeoJSON(geom) AS geojson
      FROM restoration_zone
      WHERE location_id = $1
      ORDER BY id
      LIMIT 1
    `, [req.locationId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No restoration zone found.' });
    }
    const row  = rows[0];
    const geom = JSON.parse(row.geojson);
    // GeoJSON polygon outer ring: each point is [lon, lat]
    const coordinates = geom.coordinates[0].map(([lon, lat]) => ({
      latitude:  lat,
      longitude: lon,
    }));
    res.json({
      id:          row.id,
      label:       row.label,
      area_m2:     row.area_m2,
      coordinates,
    });
  } catch (err) {
    console.error('GET /api/gis/restoration-zone:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
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
      WHERE location_id = $1
    `, [req.locationId]);
    res.json({
      total:       parseInt(s.total, 10),
      available:   parseInt(s.available, 10),
      unavailable: parseInt(s.unavailable, 10),
      scores: {
        avg: parseFloat(s.avg_score || 0),
        max: parseFloat(s.max_score || 0),
        min: parseFloat(s.min_score || 0),
      },
      depth_bands: {
        '0-3m':  parseInt(s.band_0_3m, 10),
        '3-7m':  parseInt(s.band_3_7m, 10),
        '7-10m': parseInt(s.band_7_10m, 10),
      },
    });
  } catch (err) {
    console.error('GET /api/gis/stats:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
