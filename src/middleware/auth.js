
const jwt = require('jsonwebtoken');

/**
 * JWT + location auth middleware.
 *
 * Requires:
 *   Authorization: Bearer <token>
 *   X-Location-ID: <integer>
 *
 * Attaches req.user  = { userId, name, email, nic, locationIds }
 *           req.locationId = <integer>
 */
function authMiddleware(req, res, next) {
  // ── 1. Extract token ────────────────────────────────────────────────────────
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  // ── 2. Verify JWT ───────────────────────────────────────────────────────────
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
    return res.status(401).json({ error: msg });
  }

  // ── 3. Validate X-Location-ID ───────────────────────────────────────────────
  const rawLocId = req.headers['x-location-id'];
  if (!rawLocId) {
    return res.status(403).json({ error: 'Missing X-Location-ID header.' });
  }

  const locationId = parseInt(rawLocId, 10);
  if (isNaN(locationId)) {
    return res.status(403).json({ error: 'X-Location-ID must be an integer.' });
  }

  if (!Array.isArray(payload.locationIds) || !payload.locationIds.includes(locationId)) {
    return res.status(403).json({ error: 'Access denied for this location.' });
  }

  // ── 4. Attach to request ────────────────────────────────────────────────────
  req.user       = {
    userId:      payload.userId,
    name:        payload.name,
    email:       payload.email,
    nic:         payload.nic,
    locationIds: payload.locationIds,
  };
  req.locationId = locationId;

  next();
}

/**
 * Lightweight middleware — verifies the JWT only, no X-Location-ID required.
 * Use for endpoints that identify the user but don't filter by location
 * (e.g. GET /api/auth/profile, PATCH /api/auth/profile).
 */
function jwtOnly(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired.' : 'Invalid token.';
    return res.status(401).json({ error: msg });
  }
}

module.exports = authMiddleware;
module.exports.jwtOnly = jwtOnly;
