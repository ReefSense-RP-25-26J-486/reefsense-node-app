const pool = require('../config/db');

async function saveAnalysis({
  location, date, nursery, location_id,
  coral_detected, bleaching_detected, bleaching_percentage,
  original_image_url, annotated_image_url,
}) {
  const { rows } = await pool.query(`
    INSERT INTO bleaching_history
      (location, date, nursery, location_id,
       coral_detected, bleaching_detected, bleaching_percentage,
       original_image_url, annotated_image_url)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    RETURNING *
  `, [
    location, date, nursery, location_id,
    coral_detected, bleaching_detected, bleaching_percentage,
    original_image_url || null, annotated_image_url || null,
  ]);
  return rows[0];
}

async function getHistory({ location, nursery, date, location_id } = {}) {
  const conditions = [];
  const values     = [];

  // Always filter by research site location
  if (location_id != null) {
    values.push(location_id);
    conditions.push(`location_id = $${values.length}`);
  }

  if (location) { values.push(location); conditions.push(`location = $${values.length}`); }
  if (nursery)  { values.push(nursery);  conditions.push(`nursery  = $${values.length}`); }
  if (date)     { values.push(date);     conditions.push(`date     = $${values.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT id, location, date, nursery, coral_detected, bleaching_detected,
           bleaching_percentage, original_image_url, annotated_image_url, created_at
    FROM bleaching_history ${where}
    ORDER BY created_at DESC
  `, values);
  return rows;
}

module.exports = { saveAnalysis, getHistory };
