/**
 * Optional authentication middleware.
 *
 * Routes that use this middleware work both with and without a JWT:
 *  - No Authorization header  → request proceeds; req.locationId comes from
 *    the X-Location-ID header (defaults to 1 if absent).
 *  - Valid Bearer token       → token is validated; X-Location-ID must be in
 *    the user's allowed location list.
 *  - Invalid / expired token  → 401.
 */

const jwt = require('jsonwebtoken');

module.exports = function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];

  // ── No token — public access ──────────────────────────────────────────────
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const locId = parseInt(req.headers['x-location-id']);
    req.locationId = isNaN(locId) ? 1 : locId;
    req.user = null;
    return next();
  }

  // ── Token present — validate ──────────────────────────────────────────────
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const locId = parseInt(req.headers['x-location-id']);
    if (isNaN(locId)) {
      // Authenticated but no location header — fall back to public
      req.locationId = 1;
      req.user = null;
      return next();
    }
    if (!payload.locationIds || !payload.locationIds.includes(locId)) {
      // Location not in user's allowed list — fall back to public with requested location
      req.locationId = locId;
      req.user = null;
      return next();
    }

    req.user       = payload;
    req.locationId = locId;
    next();
  } catch {
    // Invalid or expired token — fall back to public access rather than blocking.
    // (Hard 401 is reserved for fully-protected routes like /api/gis.)
    const locId = parseInt(req.headers['x-location-id']);
    req.locationId = isNaN(locId) ? 1 : locId;
    req.user = null;
    return next();
  }
};
