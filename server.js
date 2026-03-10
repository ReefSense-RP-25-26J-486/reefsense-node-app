require('dotenv').config();

const app                  = require('./app');
const { runMigrations }    = require('./src/migrations');

const PORT = process.env.PORT || 3000;

runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n===== ReefSense Unified API =====`);
      console.log(`Running on port ${PORT}`);
      console.log(`\nEndpoints:`);
      console.log(`  GET  /health`);
      console.log(`\n  [GIS — Nursery Placement]`);
      console.log(`  GET  /api/gis/nursery-types`);
      console.log(`  GET  /api/gis/candidate-points`);
      console.log(`  GET  /api/gis/top-locations?limit=10`);
      console.log(`  POST /api/gis/top-locations-by-nursery`);
      console.log(`  GET  /api/gis/nurseries`);
      console.log(`  POST /api/gis/nurseries`);
      console.log(`  GET  /api/gis/stats`);
      console.log(`\n  [Data — Temperature Records]`);
      console.log(`  GET    /api/data/records`);
      console.log(`  POST   /api/data/records`);
      console.log(`  PUT    /api/data/records/:r_id`);
      console.log(`  DELETE /api/data/records/:r_id`);
      console.log(`  GET    /api/data/temperature/records`);
      console.log(`  GET    /api/data/temperature/records/:id`);
      console.log(`  GET    /api/data/temperature/stats`);
      console.log(`\n  [Bleaching — ML Detection]`);
      console.log(`  GET  /api/bleaching/health`);
      console.log(`  POST /api/bleaching/analyze`);
      console.log(`  GET  /api/bleaching/history`);
      console.log(`\n  [Growth — Coral Tracking]`);
      console.log(`  POST /api/growth/analyze`);
      console.log(`  POST /api/growth/records`);
      console.log(`  GET  /api/growth/records`);
      console.log(`  GET  /api/growth/records/:coralId`);
    });
  })
  .catch(err => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
