const express = require('express');
const axios   = require('axios');
const pool    = require('../config/db');

const router = express.Router();

// Helper: Generate unique CT + 4 digits record code
function generateUniqueCode() {
    const digits = Math.floor(1000 + Math.random() * 9000);
    return `CT${digits}`;
}

// GET ALL RECORDS
router.get('/records', async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT * FROM coral_data ORDER BY id ASC'
        );
        res.json(rows);
    } catch (err) {
        console.error('GET /api/data/records:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ADD NEW RECORD
router.post('/records', async (req, res) => {
    const record_code = generateUniqueCode();
    const { date, time, temp3m, temp7m, temp10m,
        longitude, latitude } = req.body;

    try {
        const { rows } = await pool.query(
            `INSERT INTO coral_data(record_code, date, time, temp3m, temp7m, temp10m, longitude, latitude)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
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
            ]
        );
        res.json({ status: 'success', record_code, data: rows[0] });
    } catch (err) {
        console.error('POST /api/data/records:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE RECORD
router.put('/records/:r_id', async (req, res) => {
    const { r_id } = req.params;
    const { date, time, temp3m, temp7m, temp10m,
        longitude, latitude } = req.body;

    try {
        const { rows } = await pool.query(
            `UPDATE coral_data
            SET date=$1, time=$2, temp3m=$3, temp7m=$4, temp10m=$5, longitude=$6, latitude=$7
            WHERE id=$8 RETURNING *`,
            [date ?? null, time ?? null, temp3m ?? null, temp7m ?? null, temp10m ?? null, longitude ?? null, latitude ?? null, r_id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ detail: 'Record not found' });
        }
        res.json({ status: 'updated', data: rows[0] });
    } catch (err) {
        console.error('PUT /api/data/records:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE RECORD
router.delete('/records/:r_id', async (req, res) => {
    const { r_id } = req.params;
    try {
        const { rowCount } = await pool.query(
            'DELETE FROM coral_data WHERE id=$1', [r_id]
        );
        if (rowCount === 0) {
            return res.status(404).json({ detail: 'Record not found' });
        }
        res.json({ status: 'deleted' });
    } catch (err) {
        console.error('DELETE /api/data/records:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;