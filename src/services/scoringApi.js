
const axios = require('axios');

const BASE_URL = (process.env.GIS_SCORING_URL || '').replace(/\/$/, '');

if (!BASE_URL) {
  console.warn('[ScoringAPI] ⚠ GIS_SCORING_URL is not set — GIS scoring endpoints will fail.');
}

// Shared axios instance with timeout
const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});


/**
 * Calculate required floor-plan area for a nursery type.
 *
 * @param {{ nurseryType, widthM, lengthM, radiusM }} dims
 * @returns {Promise<number>} required_area_m2
 */
async function calculateArea({ nurseryType, widthM, lengthM, radiusM }) {
  const res = await client.post('/calculate-area', {
    nursery_type: nurseryType,
    width_m:      widthM  ?? null,
    length_m:     lengthM ?? null,
    radius_m:     radiusM ?? null,
  });
  return res.data.required_area_m2;
}


/**
 * Score and rank candidate points using AHP weights.
 *
 * @param {object[]} points       Rows from candidate_points table.
 * @param {object}   options
 *   @param {number|null} options.requiredArea  Switches to dimension-aware weights.
 *   @param {number}      options.limit         Max results to return.
 * @returns {Promise<object[]>} Ranked points with suitability_score added.
 */
async function scorePoints(points, { requiredArea = null, limit = 10 } = {}) {
  const res = await client.post('/score', {
    points,
    required_area: requiredArea,
    limit,
  });
  return res.data.points;
}


/**
 * Recalculate suitability scores for all candidate points after a nursery change.
 *
 * @param {object[]} points  All candidate_points rows.
 * @returns {Promise<Array<{fid, suitability_score}>>}
 */
async function recalculateAllScores(points) {
  const res = await client.post('/recalculate-all', { points });
  return res.data.scores; // [{ fid, suitability_score }, ...]
}


module.exports = { calculateArea, scorePoints, recalculateAllScores };
