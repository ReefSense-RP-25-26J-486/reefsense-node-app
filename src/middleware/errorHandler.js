

function errorHandler(err, req, res, _next) {
  const isDev = process.env.NODE_ENV === 'development';
  console.error(`[ERROR] ${req.method} ${req.originalUrl} —`, err.message);
  if (isDev) console.error(err.stack);

  if (err.name === 'MulterError') {
    // Multer messages are safe user-facing strings (e.g. "File too large")
    return res.status(400).json({ error: err.message }); // NOSONAR
  }
  if (err.isAxiosError) {
    const status = err.response?.status;
    if (status === 404) {
      return res.status(502).json({
        error: 'Hugging Face Space returned 404. Verify the HF_SPACE_URL is correct.',
        hf_url: process.env.HF_SPACE_URL,
      });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: 'Hugging Face Space timed out. Open it in a browser to wake it up, then retry.',
      });
    }
    return res.status(502).json({
      error: 'Failed to reach the Hugging Face inference endpoint.',
      hf_status: status || 'network error',
      ...(isDev && { detail: err.message }),
    });
  }
  if (err.message?.includes('queue is full')) {
    return res.status(503).json({ error: err.message }); // NOSONAR — controlled HF queue message
  }
  if (err.message) {
    return res.status(err.statusCode || 500).json({
      error: isDev ? err.message : 'An unexpected error occurred.',
    });
  }
  return res.status(500).json({ error: 'An unexpected error occurred.' });
}

module.exports = { errorHandler };
