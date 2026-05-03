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

    // GIS: nursery metadata columns
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS name           TEXT`,  'nurseries.name');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS coral_species  TEXT`,  'nurseries.coral_species');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS date_placement DATE`,  'nurseries.date_placement');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS depth_m        FLOAT`, 'nurseries.depth_m');
    await run(`ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS notes          TEXT`,  'nurseries.notes');

    //  GIS: candidate point availability
    await run(
      `ALTER TABLE candidate_points ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true`,
      'candidate_points.is_available'
    );
    await run(
      `UPDATE candidate_points SET is_available = true WHERE is_available IS NULL`,
      'candidate_points backfill'
    );

    // GIS: restoration zone polygon table
    await run(`
      CREATE TABLE IF NOT EXISTS restoration_zone (
        id         SERIAL PRIMARY KEY,
        label      TEXT,
        geom       geometry(Polygon, 4326),
        area_m2    FLOAT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`, 'restoration_zone table');

    // Seed the default approximate polygon if the table is empty
    await run(`
      INSERT INTO restoration_zone (label, geom, area_m2)
      SELECT
        'Port City Coral Restoration Zone',
        ST_GeomFromText(
          'POLYGON((79.818 6.944, 79.854 6.944, 79.861 6.926, 79.857 6.906, 79.82 6.903, 79.809 6.917, 79.818 6.944))',
          4326
        ),
        ROUND(
          ST_Area(ST_Transform(
            ST_GeomFromText(
              'POLYGON((79.818 6.944, 79.854 6.944, 79.861 6.926, 79.857 6.906, 79.82 6.903, 79.809 6.917, 79.818 6.944))',
              4326
            ), 32644
          ))::numeric, 2
        )
      WHERE NOT EXISTS (SELECT 1 FROM restoration_zone LIMIT 1)
    `, 'restoration_zone default polygon');

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

    // ── Auth: locations table (research sites) ──────────────────────────────
    await run(`
      CREATE TABLE IF NOT EXISTS locations (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        slug        TEXT UNIQUE NOT NULL,
        center_lat  FLOAT,
        center_lon  FLOAT,
        description TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )`, 'locations table');

    // Seed Port City as location id=1
    await run(`
      INSERT INTO locations (name, slug, center_lat, center_lon, description)
      SELECT 'Port City, Colombo', 'port-city', 6.9297, 79.8476,
             'Colombo Port City Coral Restoration Site'
      WHERE NOT EXISTS (SELECT 1 FROM locations WHERE slug = 'port-city')
    `, 'locations seed port-city');

    // ── Auth: users table ────────────────────────────────────────────────────
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id                   SERIAL PRIMARY KEY,
        name                 TEXT NOT NULL,
        nic                  TEXT UNIQUE NOT NULL,
        email                TEXT UNIQUE NOT NULL,
        password_hash        TEXT NOT NULL,
        email_verified       BOOLEAN DEFAULT false,
        verification_code    TEXT,
        verification_expires TIMESTAMPTZ,
        created_at           TIMESTAMPTZ DEFAULT NOW()
      )`, 'users table');

    // ── Auth: user_locations junction table ──────────────────────────────────
    await run(`
      CREATE TABLE IF NOT EXISTS user_locations (
        user_id     INTEGER REFERENCES users(id)     ON DELETE CASCADE,
        location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, location_id)
      )`, 'user_locations table');

    // ── location_id on all data tables (backfill existing rows → 1 = Port City)
    await run(
      `ALTER TABLE nurseries ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'nurseries.location_id'
    );
    await run(
      `UPDATE nurseries SET location_id = 1 WHERE location_id IS NULL`,
      'nurseries.location_id backfill'
    );

    await run(
      `ALTER TABLE restoration_zone ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'restoration_zone.location_id'
    );
    await run(
      `UPDATE restoration_zone SET location_id = 1 WHERE location_id IS NULL`,
      'restoration_zone.location_id backfill'
    );

    await run(
      `ALTER TABLE candidate_points ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'candidate_points.location_id'
    );
    await run(
      `UPDATE candidate_points SET location_id = 1 WHERE location_id IS NULL`,
      'candidate_points.location_id backfill'
    );

    await run(
      `ALTER TABLE bleaching_history ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'bleaching_history.location_id'
    );
    await run(
      `UPDATE bleaching_history SET location_id = 1 WHERE location_id IS NULL`,
      'bleaching_history.location_id backfill'
    );

    await run(
      `ALTER TABLE coral_data ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'coral_data.location_id'
    );
    await run(
      `UPDATE coral_data SET location_id = 1 WHERE location_id IS NULL`,
      'coral_data.location_id backfill'
    );

    await run(
      `ALTER TABLE coral_records ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) DEFAULT 1`,
      'coral_records.location_id'
    );
    await run(
      `UPDATE coral_records SET location_id = 1 WHERE location_id IS NULL`,
      'coral_records.location_id backfill'
    );

    // Growth: link coral records to a nursery
    await run(
      `ALTER TABLE coral_records ADD COLUMN IF NOT EXISTS nursery_id INTEGER REFERENCES nurseries(id)`,
      'coral_records.nursery_id'
    );

    console.log('[Migrations] Complete ✓');
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
