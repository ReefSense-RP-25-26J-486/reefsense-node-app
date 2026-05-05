const express  = require('express');
const multer   = require('multer');
const axios    = require('axios');
const FormData = require('form-data');
const pool = require('../config/db');
const { uploadGrowthImage } = require('../services/cloudinary');
const { extractImageLocation } = require('../services/imageMetadata');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});


router.post('/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No image file provided. Use form-data field name "file".',
    });
  }

  const hfUrl = process.env.HUGGINGFACE_SPACE_URL;
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  if (!hfUrl || !apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: HUGGINGFACE_SPACE_URL or HUGGINGFACE_API_KEY not set.' });
  }

  try {
    // Extract GPS from raw JPEG bytes before forwarding — same method as bleaching.
    // This is the only reliable approach on Android where client-side EXIF is
    // stripped by image crop/compression libraries.
    const { image_latitude, image_longitude } = extractImageLocation(req.file.buffer);
    console.log(`[Growth/analyze] GPS from EXIF: lat=${image_latitude}, lon=${image_longitude}`);

    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename:    req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype,
    });

    console.log(`[Growth/analyze] forwarding ${req.file.size} byte image to HF space`);
    const response = await axios.post(`${hfUrl}/predict`, formData, {
      headers: { ...formData.getHeaders(), 'x-api-key': apiKey },
      timeout: 120_000,
      maxContentLength: Infinity,
      maxBodyLength:    Infinity,
    });

    // Strip enhanced_image from the response — it is never rendered in the app
    // but can be 10–30 MB of base64 for large iPhone photos, causing the mobile
    // fetch to fail while buffering the full JSON payload.
    const { enhanced_image, ...payload } = response.data;
    const detectionCount = Array.isArray(payload.detections) ? payload.detections.length : '?';
    console.log(`[Growth/analyze] HF OK — ${detectionCount} detection(s)`);

    // Return GPS alongside the HF payload so the app can store it with the record
    return res.status(200).json({ ...payload, image_latitude, image_longitude });
  } catch (err) {
    if (err.response) {
      console.error(`[Growth/analyze] HF error ${err.response.status}:`, JSON.stringify(err.response.data).slice(0, 300));
      return res.status(err.response.status).json({
        error:   'HuggingFace inference failed',
        details: err.response.data,
      });
    }
    if (err.code === 'ECONNABORTED') {
      console.error('[Growth/analyze] HF timeout after 120s');
      return res.status(504).json({ error: 'HuggingFace request timed out' });
    }
    console.error('[Growth/analyze] unexpected error:', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service' });
  }
});


// POST /records — save a growth record tagged with the selected location
router.post('/records', async (req, res) => {
  const { coral_id, species, area_cm2, confidence, cnn_feed_image, nursery_id, latitude, longitude, remarks } = req.body;

  if (!coral_id || !species || area_cm2 == null) {
    return res.status(400).json({
      error: 'coral_id, species, and area_cm2 are required',
    });
  }

  try {
    const { rows: prior } = await pool.query(
      `SELECT area_cm2 FROM coral_records
       WHERE coral_id = $1 AND location_id = $2
       ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [coral_id, req.locationId]
    );

    // Upload annotated image to Cloudinary if provided
    let image_url = null;
    if (cnn_feed_image) {
      try {
        const uploaded = await uploadGrowthImage(cnn_feed_image, 'image/jpeg');
        image_url = uploaded.url;
      } catch (uploadErr) {
        console.error('Cloudinary upload failed (non-fatal):', uploadErr.message);
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO coral_records
         (coral_id, species, area_cm2, confidence, cnn_feed_image, location_id, nursery_id, latitude, longitude, remarks, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        coral_id, species, area_cm2, confidence ?? 0, cnn_feed_image ?? '',
        req.locationId, nursery_id ?? null,
        latitude ?? null, longitude ?? null, remarks ?? null, image_url,
      ]
    );

    const lastRecord  = prior[0] || null;
    const growth_cm2  = lastRecord
      ? parseFloat((area_cm2 - lastRecord.area_cm2).toFixed(4))
      : null;

    return res.status(201).json({
      success: true,
      record:  rows[0],
      growth_cm2,
      previous_area_cm2: lastRecord ? lastRecord.area_cm2 : null,
    });
  } catch (err) {
    console.error('POST /api/growth/records:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// GET /records — list all corals (latest record per coral_id) for this location
router.get('/records', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        cr.coral_id,
        cr.species,
        cr.area_cm2  AS latest_area,
        cr.recorded_at AS last_recorded,
        (SELECT COUNT(*) FROM coral_records WHERE coral_id = cr.coral_id AND location_id = $1)::int AS record_count
      FROM coral_records cr
      WHERE cr.location_id = $1
        AND cr.id = (
          SELECT id FROM coral_records
          WHERE coral_id = cr.coral_id AND location_id = $1
          ORDER BY recorded_at DESC, id DESC
          LIMIT 1
        )
      ORDER BY last_recorded DESC
    `, [req.locationId]);
    return res.json({ corals: rows });
  } catch (err) {
    console.error('GET /api/growth/records:', err.message);
    res.status(500).json({ error: err.message });
  }
});


// GET /records/:coralId — full history for a specific coral in this location
router.get('/records/:coralId', async (req, res) => {
  const { coralId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, coral_id, species, area_cm2, confidence, cnn_feed_image, recorded_at,
              latitude, longitude, remarks, image_url
       FROM coral_records
       WHERE coral_id = $1 AND location_id = $2
       ORDER BY recorded_at ASC`,
      [coralId, req.locationId]
    );

    const recordsWithGrowth = rows.map((record, i) => ({
      ...record,
      growth_cm2: i > 0
        ? parseFloat((record.area_cm2 - rows[i - 1].area_cm2).toFixed(4))
        : 0,
    }));

    return res.json({ coral_id: coralId, records: recordsWithGrowth });
  } catch (err) {
    console.error('GET /api/growth/records/:coralId:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /records/entry/:recordId — delete a single record (scoped to location)
router.delete('/records/entry/:recordId', async (req, res) => {
  const recordId = parseInt(req.params.recordId, 10);
  if (isNaN(recordId)) {
    return res.status(400).json({ error: 'Invalid record ID' });
  }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coral_records WHERE id = $1 AND location_id = $2',
      [recordId, req.locationId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Record not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/growth/records/entry/:recordId:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /records/:coralId — delete all records for a coral in this location
router.delete('/records/:coralId', async (req, res) => {
  const { coralId } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coral_records WHERE coral_id = $1 AND location_id = $2',
      [coralId, req.locationId]
    );
    return res.json({ success: true, deleted: rowCount });
  } catch (err) {
    console.error('DELETE /api/growth/records/:coralId:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
