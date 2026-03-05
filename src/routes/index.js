const gisRouter       = require('./gis');
const coralDataRouter = require('./coralData');
const bleachingRouter = require('./bleaching');
const growthRouter    = require('./growth');

module.exports = function mountRoutes(app) {
  app.use('/api/gis',       gisRouter);
  app.use('/api/data',      coralDataRouter);
  app.use('/api/bleaching', bleachingRouter);
  app.use('/api/growth',    growthRouter);
};
