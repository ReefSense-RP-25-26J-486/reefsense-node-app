/**
 * One-time script: replaces the restoration_zone polygon with the accurate
 * boundary exported from QGIS (resotration_zone.geojson).
 *
 * Run from the reefsense-node-app root:
 *   node scripts/update_restoration_zone.js
 *
 * Requires DATABASE_URL to be set in your .env file (same as the main app).
 */

'use strict';

require('dotenv').config();
const pool = require('../src/config/db');

// ── Accurate polygon from QGIS export (WGS84 / EPSG:4326, lon-lat order) ──
const GEOJSON_GEOMETRY = {
  type: 'Polygon',
  coordinates: [[
    [ 79.826649531116928, 6.926138086158039 ],
    [ 79.826634444164966, 6.926155814643579 ],
    [ 79.826613367850257, 6.92617609070913  ],
    [ 79.826593315084594, 6.926197223421112 ],
    [ 79.826572749063857, 6.926218525689295 ],
    [ 79.826553036070678, 6.926240513358871 ],
    [ 79.826534009383948, 6.926261477775912 ],
    [ 79.826515320782477, 6.926283980444683 ],
    [ 79.826478657753398, 6.926316688196402 ],
    [ 79.826465789679091, 6.92633578874588  ],
    [ 79.826446927593821, 6.926359315928069 ],
    [ 79.826413126677068, 6.926409796459525 ],
    [ 79.826396826630514, 6.926434184084954 ],
    [ 79.826363371390883, 6.92648312804622  ],
    [ 79.826346045676303, 6.926507513136741 ],
    [ 79.826428998075599, 6.926558794380044 ],
    [ 79.826486865672976, 6.926592247965293 ],
    [ 79.826545917639947, 6.926630658371632 ],
    [ 79.826583457718542, 6.926658082919179 ],
    [ 79.826610761439355, 6.92667728263288  ],
    [ 79.826624409922601, 6.92668824907495  ],
    [ 79.826675125839017, 6.926641226764755 ],
    [ 79.826718978659784, 6.926604436963681 ],
    [ 79.826758733888838, 6.926565587153131 ],
    [ 79.826808776136275, 6.926514463379077 ],
    [ 79.826858137975023, 6.926461971324589 ],
    [ 79.826906816027659, 6.926409477575673 ],
    [ 79.826939046322821, 6.926371975769405 ],
    [ 79.826865199069886, 6.926302438883708 ],
    [ 79.826850707691065, 6.926286687289726 ],
    [ 79.826836897555111, 6.926271962322225 ],
    [ 79.826820346410543, 6.926259622129846 ],
    [ 79.826804988073292, 6.9262488222991   ],
    [ 79.826768469447742, 6.92622310853536  ],
    [ 79.826752440003631, 6.926207182319173 ],
    [ 79.826735044277754, 6.926190740257863 ],
    [ 79.826718498627358, 6.926176179360975 ],
    [ 79.826698701670821, 6.926162977033364 ],
    [ 79.826676508126639, 6.926151135384169 ],
    [ 79.826649531116928, 6.926138086158039 ], // closed ring (= first point)
  ]],
};

// Area from QGIS properties (m²)
const AREA_M2 = 2080.7411220592912;
const LABEL   = 'Port City Coral Restoration Zone';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Wipe existing row(s) and insert the accurate one
    await client.query('DELETE FROM restoration_zone');

    const { rows } = await client.query(
      `INSERT INTO restoration_zone (label, geom, area_m2)
       VALUES (
         $1,
         ST_SetSRID(ST_GeomFromGeoJSON($2), 4326),
         $3
       )
       RETURNING id, label, area_m2,
         ST_Area(ST_Transform(geom, 32644)) AS computed_area_m2`,
      [LABEL, JSON.stringify(GEOJSON_GEOMETRY), AREA_M2]
    );

    await client.query('COMMIT');

    const row = rows[0];
    console.log('\n✅  Restoration zone updated successfully!');
    console.log(`   id          : ${row.id}`);
    console.log(`   label       : ${row.label}`);
    console.log(`   stored area : ${Number(row.area_m2).toFixed(2)} m²`);
    console.log(`   PostGIS area: ${Number(row.computed_area_m2).toFixed(2)} m²`);
    console.log('\nThe map and main panel will show the accurate polygon on next app load.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌  Failed to update restoration zone:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
