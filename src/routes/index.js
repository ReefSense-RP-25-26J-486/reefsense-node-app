const authRouter      = require('./auth');
const gisRouter       = require('./gis');
const coralDataRouter = require('./coralData');
const bleachingRouter = require('./bleaching');
const growthRouter    = require('./growth');
const authMiddleware  = require('../middleware/auth');

module.exports = function mountRoutes(app) {
  // Public — no JWT required
  app.use('/api/auth',      authRouter);

  // Protected — JWT + X-Location-ID required for all data routes
  app.use('/api/gis',       authMiddleware, gisRouter);
  app.use('/api/data',      authMiddleware, coralDataRouter);
  app.use('/api/bleaching', authMiddleware, bleachingRouter);
  app.use('/api/growth',    authMiddleware, growthRouter);
};
