
const express = require('express');
const multer  = require('multer');

const { predictReefHealth }    = require('../services/huggingface');
const { saveAnalysis, getHistory } = require('../services/bleachingHistory');
const { validateAnalyzeInput } = require('../middleware/validateInput');
const { uploadOriginalImage, uploadAnnotatedImage } = require('../services/cloudinary');

const router = express.Router();

// Multer: memory storage, 10 MB cap, images only
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted.'));
    }
    cb(null, true);
  },
});

// ── GET /health ────────────────────────────────────────────────────────────────

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', component: 'bleaching', timestamp: new Date().toISOString() });
});

// ── POST /analyze ──────────────────────────────────────────────────────────────

router.post(
  '/analyze',
  upload.single('image'),
  validateAnalyzeInput,
  async (req, res, next) => {
    try {
      const { location, date, nursery } = req.body;
      const { buffer, mimetype, originalname } = req.file;

      // Upload original to Cloudinary + run HF inference in parallel
      const [originalUpload, hfResult] = await Promise.all([
        uploadOriginalImage(buffer, mimetype, originalname),
        predictReefHealth(buffer, mimetype, originalname),
      ]);

      const { annotatedImage, stats } = hfResult;

      // Upload annotated result to Cloudinary
      const annotatedUpload = await uploadAnnotatedImage(annotatedImage, mimetype);

      // Persist to PostgreSQL
      await saveAnalysis({
        location,
        date,
        nursery,
        coral_detected:       stats.coral_detected,
        bleaching_detected:   stats.bleaching_detected,
        bleaching_percentage: stats.bleaching_percentage,
        original_image_url:   originalUpload.url,
        annotated_image_url:  annotatedUpload.url,
      });

      return res.status(200).json({
        coral_detected:       stats.coral_detected,
        bleaching_detected:   stats.bleaching_detected,
        bleaching_percentage: stats.bleaching_percentage,
        original_image_url:   originalUpload.url,
        annotated_image_url:  annotatedUpload.url,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /history ───────────────────────────────────────────────────────────────

router.get('/history', async (req, res, next) => {
  try {
    const location = req.query.location?.trim() || undefined;
    const nursery  = req.query.nursery?.trim()  || undefined;
    const date     = req.query.date?.trim()     || undefined;

    const records = await getHistory({ location, nursery, date });

    return res.status(200).json({
      filters: { location, nursery, date },
      count:   records.length,
      history: records,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
