const pool = require('../config/db');

async function saveAnalysis({
  location, date, nursery, location_id,
  coral_detected, bleaching_detected, bleaching_percentage,
  original_image_url, annotated_image_url,
  remarks, coral_id,
  image_latitude, image_longitude,
}) {
  const { rows } = await pool.query(`
    INSERT INTO bleaching_history
      (location, date, nursery, location_id,
       coral_detected, bleaching_detected, bleaching_percentage,
       original_image_url, annotated_image_url, remarks, coral_id,
       image_latitude, image_longitude)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
    location, date, nursery, location_id,
    coral_detected, bleaching_detected, bleaching_percentage,
    original_image_url || null, annotated_image_url || null,
    remarks || null, coral_id || null,
    image_latitude ?? null, image_longitude ?? null,
  ]);
  return rows[0];
}

async function getHistory({ location, nursery, date, location_id } = {}) {
  const conditions = [];
  const values     = [];

  // Always filter by research site location
  if (location_id !== null && location_id !== undefined) {
    values.push(location_id);
    conditions.push(`bh.location_id = $${values.length}`);
  }

  if (location) { values.push(location); conditions.push(`bh.location = $${values.length}`); }
  if (nursery)  { values.push(nursery);  conditions.push(`bh.nursery  = $${values.length}`); }
  if (date)     { values.push(date);     conditions.push(`bh.date     = $${values.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(`
    SELECT bh.id, bh.location, bh.date, bh.nursery, bh.coral_detected, bh.bleaching_detected,
           bh.bleaching_percentage, bh.original_image_url, bh.annotated_image_url, bh.remarks, bh.coral_id,
           bh.image_latitude, bh.image_longitude, bh.created_at,
           CASE WHEN l.id IS NULL THEN NULL ELSE json_build_object(
             'id', l.id,
             'name', l.name,
             'slug', l.slug,
             'center_lat', l.center_lat,
             'center_lon', l.center_lon,
             'description', l.description
           ) END AS location_details
    FROM bleaching_history bh
    LEFT JOIN locations l ON l.id = bh.location_id
    ${where}
    ORDER BY bh.created_at DESC
  `, values);
  return rows;
}

async function getLocationDetails(location_id) {
  if (location_id === null || location_id === undefined) return null;

  const { rows } = await pool.query(
    `SELECT id, name, slug, center_lat, center_lon, description
     FROM locations
     WHERE id = $1`,
    [location_id]
  );

  return rows[0] || null;
}

module.exports = { saveAnalysis, getHistory, getLocationDetails };
