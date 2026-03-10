const authRouter      = require('./auth');
const gisRouter       = require('./gis');
const coralDataRouter = require('./coralData');
const bleachingRouter = require('./bleaching');
const growthRouter    = require('./growth');
const authMiddleware  = require('../middleware/auth');
const optionalAuth    = require('../middleware/optionalAuth');

module.exports = function mountRoutes(app) {
  // Public — no JWT required
  app.use('/api/auth',      authRouter);

  // Fully protected — JWT + X-Location-ID required
  app.use('/api/gis',       authMiddleware, gisRouter);
  app.use('/api/bleaching', authMiddleware, bleachingRouter);

  // Optional auth — work with or without JWT; X-Location-ID defaults to 1
  app.use('/api/data',      optionalAuth, coralDataRouter);
  app.use('/api/growth',    optionalAuth, growthRouter);
};
