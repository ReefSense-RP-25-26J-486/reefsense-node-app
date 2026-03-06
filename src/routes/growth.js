const express  = require('express');
const multer   = require('multer');
const axios    = require('axios');
const FormData = require('form-data');
const pool = require('../config/db');

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
    const formData = new FormData();
    formData.append('file', req.file.buffer, {
      filename:    req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype,
    });

    const response = await axios.post(`${hfUrl}/predict`, formData, {
      headers: { ...formData.getHeaders(), 'x-api-key': apiKey },
      timeout: 120_000,
    });

    return res.status(200).json(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({
        error:   'HuggingFace inference failed',
        details: err.response.data,
      });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'HuggingFace request timed out' });
    }
    console.error('Growth HF error:', err.message);
    return res.status(500).json({ error: 'Failed to reach AI service' });
  }
});



router.post('/records', async (req, res) => {
  const { coral_id, species, area_cm2, confidence, cnn_feed_image } = req.body;

  if (!coral_id || !species || area_cm2 == null) {
    return res.status(400).json({
      error: 'coral_id, species, and area_cm2 are required',
    });
  }

  try {
    const { rows: prior } = await pool.query(
      `SELECT area_cm2 FROM coral_records
       WHERE coral_id = $1
       ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [coral_id]
    );

    const { rows } = await pool.query(
      `INSERT INTO coral_records (coral_id, species, area_cm2, confidence, cnn_feed_image)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [coral_id, species, area_cm2, confidence ?? 0, cnn_feed_image ?? '']
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



router.get('/records', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        cr.coral_id,
        cr.species,
        cr.area_cm2  AS latest_area,
        cr.recorded_at AS last_recorded,
        (SELECT COUNT(*) FROM coral_records WHERE coral_id = cr.coral_id)::int AS record_count
      FROM coral_records cr
      WHERE cr.id = (
        SELECT id FROM coral_records
        WHERE coral_id = cr.coral_id
        ORDER BY recorded_at DESC, id DESC
        LIMIT 1
      )
      ORDER BY last_recorded DESC
    `);
    return res.json({ corals: rows });
  } catch (err) {
    console.error('GET /api/growth/records:', err.message);
    res.status(500).json({ error: err.message });
  }
});



router.get('/records/:coralId', async (req, res) => {
  const { coralId } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, coral_id, species, area_cm2, confidence, cnn_feed_image, recorded_at
       FROM coral_records
       WHERE coral_id = $1
       ORDER BY recorded_at ASC`,
      [coralId]
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

// DELETE /api/growth/records/entry/:recordId  — delete a single record
router.delete('/records/entry/:recordId', async (req, res) => {
  const recordId = parseInt(req.params.recordId, 10);
  if (isNaN(recordId)) {
    return res.status(400).json({ error: 'Invalid record ID' });
  }
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coral_records WHERE id = $1',
      [recordId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Record not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/growth/records/entry/:recordId:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/growth/records/:coralId  — delete all records for a coral
router.delete('/records/:coralId', async (req, res) => {
  const { coralId } = req.params;
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM coral_records WHERE coral_id = $1',
      [coralId]
    );
    return res.json({ success: true, deleted: rowCount });
  } catch (err) {
    console.error('DELETE /api/growth/records/:coralId:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
