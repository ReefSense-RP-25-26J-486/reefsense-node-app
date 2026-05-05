
function validateAnalyzeInput(req, res, next) {
  const { location, date, nursery, remarks, coral_id } = req.body;
  if (!req.file) {
    return res.status(400).json({ error: 'Image file is required (field: image).' });
  }
  if (!location || String(location).trim() === '') {
    return res.status(400).json({ error: 'location is required in the request body.' });
  }
  if (!date || String(date).trim() === '') {
    return res.status(400).json({ error: 'date is required in the request body.' });
  }
  req.body.location = String(location).trim();
  req.body.date     = String(date).trim();
  req.body.nursery  = nursery == null || String(nursery).trim() === ''
    ? null
    : String(nursery).trim();
  req.body.remarks  = remarks == null || String(remarks).trim() === ''
    ? null
    : String(remarks).trim();
  req.body.coral_id = coral_id == null || String(coral_id).trim() === ''
    ? null
    : String(coral_id).trim();
  next();
}

module.exports = { validateAnalyzeInput };
