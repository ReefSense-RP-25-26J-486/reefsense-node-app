const express        = require('express');
const { randomInt }  = require('crypto');
const pool           = require('../config/db');

const router = express.Router();

// Helper: Generate unique CT + 4 digits record code
function generateUniqueCode() {
    const digits = randomInt(1000, 10000);
    return `CT${digits}`;
}

// GET ALL RECORDS — filtered by the authenticated user's selected location
router.get('/records', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM coral_data WHERE location_id = $1 ORDER BY id ASC',
            [req.locationId]
        );
        res.json(rows);
    } catch (err) {
        console.error('GET /api/data/records:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// ADD NEW RECORD — tagged with the selected location
router.post('/records', async (req, res) => {
    const record_code = generateUniqueCode();
    const { date, time, temp3m, temp7m, temp10m,
        longitude, latitude } = req.body;

    try {
        const { rows } = await pool.query(
            `INSERT INTO coral_data(record_code, date, time, temp3m, temp7m, temp10m, longitude, latitude, location_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *`,
            [
                record_code,
                date      ?? null,
                time      ?? null,
                temp3m    ?? null,
                temp7m    ?? null,
                temp10m   ?? null,
                longitude ?? null,
                latitude  ?? null,
                req.locationId,
            ]
        );
        res.json({ status: 'success', record_code, data: rows[0] });
    } catch (err) {
        console.error('POST /api/data/records:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// UPDATE RECORD — scoped to the selected location for security
router.put('/records/:r_id', async (req, res) => {
    const { r_id } = req.params;
    const { date, time, temp3m, temp7m, temp10m,
        longitude, latitude } = req.body;

    try {
        const { rows } = await pool.query(
            `UPDATE coral_data
            SET date=$1, time=$2, temp3m=$3, temp7m=$4, temp10m=$5, longitude=$6, latitude=$7
            WHERE id=$8 AND location_id=$9 RETURNING *`,
            [
                date ?? null, time ?? null, temp3m ?? null, temp7m ?? null,
                temp10m ?? null, longitude ?? null, latitude ?? null,
                r_id, req.locationId,
            ]
        );
        if (rows.length === 0) {
            return res.status(404).json({ detail: 'Record not found' });
        }
        res.json({ status: 'updated', data: rows[0] });
    } catch (err) {
        console.error('PUT /api/data/records:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// DELETE RECORD — scoped to the selected location for security
router.delete('/records/:r_id', async (req, res) => {
    const { r_id } = req.params;
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM coral_data WHERE id=$1 AND location_id=$2',
            [r_id, req.locationId]
        );
        if (rowCount === 0) {
            return res.status(404).json({ detail: 'Record not found' });
        }
        res.json({ status: 'deleted' });
    } catch (err) {
        console.error('DELETE /api/data/records:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

module.exports = router;
