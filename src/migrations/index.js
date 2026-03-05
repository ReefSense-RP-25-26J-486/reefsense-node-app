const pool = require('../config/db');

async function runMigrations() {
  const client = await pool.connect();

  /** Run one SQL statement, log a warning on failure but never crash. */
  async function run(sql, label) {
    try {
      await client.query(sql);
      console.log(`[Migration] ✓ ${label}`);
    } catch (err) {
      console.warn(`[Migration] ⚠ ${label}: ${err.message}`);
    }
  }

  try {
    // GIS: nursery dimension columns
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS width_m  FLOAT`, 'nurseries.width_m');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS length_m FLOAT`, 'nurseries.length_m');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS radius_m FLOAT`, 'nurseries.radius_m');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS height_m FLOAT`, 'nurseries.height_m');

    //  GIS: candidate point availability
    await run(
      `ALTER TABLE candidate_points ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true`,
      'candidate_points.is_available'
    );
    await run(
      `UPDATE candidate_points SET is_available = true WHERE is_available IS NULL`,
      'candidate_points backfill'
    );

    //  Coral data (manual temperature records) 
    await run(`
      CREATE TABLE IF NOT EXISTS coral_data (
        id          SERIAL PRIMARY KEY,
        record_code TEXT    NOT NULL,
        date        VARCHAR,
        time        VARCHAR,
        temp3m      FLOAT,
        temp7m      FLOAT,
        temp10m     FLOAT,
        longitude   VARCHAR,
        latitude    VARCHAR,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )`, 'coral_data table');
    await run(`ALTER TABLE coral_data ADD COLUMN IF NOT EXISTS date       VARCHAR`, 'coral_data.date');
    await run(`ALTER TABLE coral_data ADD COLUMN IF NOT EXISTS time       VARCHAR`, 'coral_data.time');
    await run(`ALTER TABLE coral_data ADD COLUMN IF NOT EXISTS longitude  VARCHAR`, 'coral_data.longitude');
    await run(`ALTER TABLE coral_data ADD COLUMN IF NOT EXISTS latitude   VARCHAR`, 'coral_data.latitude');

    //  Bleaching detection history 
    await run(`
      CREATE TABLE IF NOT EXISTS bleaching_history (
        id                   SERIAL        PRIMARY KEY,
        location             TEXT          NOT NULL,
        date                 TEXT          NOT NULL,
        nursery              TEXT          NOT NULL,
        coral_detected       INTEGER       NOT NULL DEFAULT 0,
        bleaching_detected   INTEGER       NOT NULL DEFAULT 0,
        bleaching_percentage NUMERIC(5,2)  NOT NULL DEFAULT 0.00,
        original_image_url   TEXT,
        annotated_image_url  TEXT,
        created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      )`, 'bleaching_history table');
    await run(
      `CREATE INDEX IF NOT EXISTS idx_bleaching_location ON bleaching_history(location)`,
      'idx_bleaching_location'
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_bleaching_nursery ON bleaching_history(nursery)`,
      'idx_bleaching_nursery'
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_bleaching_history_created_at ON bleaching_history(created_at DESC)`,
      'idx_bleaching_history_created_at'
    );

    //  Coral growth records 
    await run(`
      CREATE TABLE IF NOT EXISTS coral_records (
        id             SERIAL PRIMARY KEY,
        coral_id       TEXT NOT NULL,
        species        TEXT NOT NULL,
        area_cm2       REAL NOT NULL,
        confidence     REAL NOT NULL DEFAULT 0,
        cnn_feed_image TEXT NOT NULL DEFAULT '',
        recorded_at    TIMESTAMPTZ DEFAULT NOW()
      )`, 'coral_records table');
    await run(
      `CREATE INDEX IF NOT EXISTS idx_coral_id    ON coral_records(coral_id)`,
      'idx_coral_id'
    );
    await run(
      `CREATE INDEX IF NOT EXISTS idx_recorded_at ON coral_records(recorded_at)`,
      'idx_recorded_at'
    );

    console.log('[Migrations] Complete ✓');
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
