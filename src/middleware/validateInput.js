
function validateAnalyzeInput(req, res, next) {
  const { location, date, nursery } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required (field: image).' });
  }
  if (!location || String(location).trim() === '') {
    return res.status(400).json({ error: 'location is required in the request body.' });
  }
  if (!date || String(date).trim() === '') {
    return res.status(400).json({ error: 'date is required in the request body.' });
  }
  if (!nursery || String(nursery).trim() === '') {
    return res.status(400).json({ error: 'nursery is required in the request body.' });
  }
  req.body.location = String(location).trim();
  req.body.date     = String(date).trim();
  req.body.nursery  = String(nursery).trim();
  next();
}

module.exports = { validateAnalyzeInput };
