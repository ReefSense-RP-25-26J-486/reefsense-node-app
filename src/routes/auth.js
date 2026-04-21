
const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const pool     = require('../config/db');
const { sendVerificationEmail } = require('../services/email');
const authMiddleware = require('../middleware/auth');
const { jwtOnly }   = require('../middleware/auth');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function signToken(user, locationIds) {
  return jwt.sign(
    { userId: user.id, name: user.name, email: user.email, nic: user.nic, locationIds },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Create an unverified user and email a 6-digit OTP.

router.post('/register', async (req, res) => {
  const { name, nic, email, password } = req.body;

  if (!name || !nic || !email || !password) {
    return res.status(422).json({ error: 'name, nic, email and password are required.' });
  }
  if (password.length < 6) {
    return res.status(422).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // Check if account already exists
    const { rows: existing } = await pool.query(
      `SELECT id, email_verified FROM users WHERE email = $1 OR nic = $2 LIMIT 1`,
      [email.toLowerCase(), nic]
    );

    const code    = generateOTP();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    if (existing.length > 0) {
      if (existing[0].email_verified) {
        return res.status(409).json({ error: 'An account with this email or NIC already exists.' });
      }
      // Unverified account — update details and refresh OTP
      const password_hash = await bcrypt.hash(password, 12);
      await pool.query(
        `UPDATE users
         SET name = $1, password_hash = $2,
             verification_code = $3, verification_expires = $4
         WHERE id = $5`,
        [name.trim(), password_hash, code, expires, existing[0].id]
      );
      await sendVerificationEmail(email.toLowerCase(), code);
      return res.status(201).json({ message: 'Verification code sent. Please check your inbox.' });
    }

    // Brand new account — create unverified and send OTP
    const password_hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (name, nic, email, password_hash, email_verified, verification_code, verification_expires)
       VALUES ($1, $2, $3, $4, false, $5, $6)`,
      [name.trim(), nic.trim(), email.toLowerCase(), password_hash, code, expires]
    );

    await sendVerificationEmail(email.toLowerCase(), code);
    return res.status(201).json({ message: 'Verification code sent. Please check your inbox.' });
  } catch (err) {
    console.error('POST /api/auth/register:', err.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/verify-email ───────────────────────────────────────────────
// Validate the OTP and mark the account as verified.

router.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) {
    return res.status(422).json({ error: 'email and code are required.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, verification_code, verification_expires, email_verified
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Account not found.' });
    }

    const user = rows[0];
    if (user.email_verified) {
      return res.status(409).json({ error: 'Email is already verified.' });
    }
    if (user.verification_code !== code) {
      return res.status(400).json({ error: 'Incorrect verification code.' });
    }
    if (new Date() > new Date(user.verification_expires)) {
      return res.status(400).json({ error: 'Verification code has expired. Please register again to get a new code.' });
    }

    await pool.query(
      `UPDATE users
       SET email_verified = true, verification_code = NULL, verification_expires = NULL
       WHERE id = $1`,
      [user.id]
    );

    return res.json({ message: 'Email verified successfully. Please select your locations.' });
  } catch (err) {
    console.error('POST /api/auth/verify-email:', err.message);
    return res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── POST /api/auth/resend-code ────────────────────────────────────────────────
// Resend OTP for an unverified account.

router.post('/resend-code', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(422).json({ error: 'email is required.' });

  try {
    const { rows } = await pool.query(
      `SELECT id, email_verified FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });
    if (rows[0].email_verified) return res.status(409).json({ error: 'Email is already verified.' });

    const code    = generateOTP();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `UPDATE users SET verification_code = $1, verification_expires = $2 WHERE id = $3`,
      [code, expires, rows[0].id]
    );

    await sendVerificationEmail(email, code);
    return res.json({ message: 'New verification code sent.' });
  } catch (err) {
    console.error('POST /api/auth/resend-code:', err.message);
    return res.status(500).json({ error: 'Failed to resend code.' });
  }
});

// ── GET /api/auth/locations ───────────────────────────────────────────────────
// Return all available research site locations (public — needed during registration).

router.get('/locations', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, center_lat, center_lon, description FROM locations ORDER BY id ASC`
    );
    return res.json({ locations: rows });
  } catch (err) {
    console.error('GET /api/auth/locations:', err.message);
    return res.status(500).json({ error: 'Failed to fetch locations.' });
  }
});

// ── POST /api/auth/complete-registration ─────────────────────────────────────
// Save location selections and return a JWT (completes the sign-up flow).

router.post('/complete-registration', async (req, res) => {
  const { email, locationIds } = req.body;

  if (!email || !Array.isArray(locationIds) || locationIds.length === 0) {
    return res.status(422).json({ error: 'email and at least one locationId are required.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, nic, email, email_verified FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Account not found.' });

    const user = rows[0];
    if (!user.email_verified) {
      return res.status(403).json({ error: 'Email must be verified before completing registration.' });
    }

    // Validate location IDs exist
    const { rows: validLocs } = await pool.query(
      `SELECT id FROM locations WHERE id = ANY($1::int[])`,
      [locationIds]
    );
    if (validLocs.length === 0) {
      return res.status(422).json({ error: 'None of the provided location IDs are valid.' });
    }
    const validIds = validLocs.map(r => r.id);

    // Upsert user_locations (replace existing selections)
    await pool.query(`DELETE FROM user_locations WHERE user_id = $1`, [user.id]);
    for (const locId of validIds) {
      await pool.query(
        `INSERT INTO user_locations (user_id, location_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [user.id, locId]
      );
    }

    const token = signToken(user, validIds);
    return res.json({
      message: 'Registration complete.',
      token,
      user: { id: user.id, name: user.name, email: user.email, nic: user.nic, locationIds: validIds },
    });
  } catch (err) {
    console.error('POST /api/auth/complete-registration:', err.message);
    return res.status(500).json({ error: 'Failed to complete registration.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Login with email OR NIC + password.

router.post('/login', async (req, res) => {
  const { identifier, password } = req.body;
  if (!identifier || !password) {
    return res.status(422).json({ error: 'identifier (email or NIC) and password are required.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, name, nic, email, password_hash, email_verified
       FROM users
       WHERE email = $1 OR nic = $1`,
      [identifier.toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    if (!user.email_verified) {
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        unverified: true,
        email: user.email,
      });
    }

    // Fetch location IDs
    const { rows: locRows } = await pool.query(
      `SELECT location_id FROM user_locations WHERE user_id = $1`,
      [user.id]
    );
    if (locRows.length === 0) {
      return res.status(403).json({ error: 'No locations assigned. Please contact support.' });
    }

    const locationIds = locRows.map(r => r.location_id);
    const token = signToken(user, locationIds);

    return res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, nic: user.nic, locationIds },
    });
  } catch (err) {
    console.error('POST /api/auth/login:', err.message);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/profile ─────────────────────────────────────────────────────
// Return authenticated user's profile + their assigned locations.

router.get('/profile', jwtOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.nic, u.email, u.created_at,
              json_agg(json_build_object('id', l.id, 'name', l.name, 'slug', l.slug,
                'center_lat', l.center_lat, 'center_lon', l.center_lon)
                ORDER BY l.id) AS locations
       FROM users u
       JOIN user_locations ul ON ul.user_id = u.id
       JOIN locations l        ON l.id = ul.location_id
       WHERE u.id = $1
       GROUP BY u.id`,
      [req.user.userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: rows[0] });
  } catch (err) {
    console.error('GET /api/auth/profile:', err.message);
    return res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// ── PATCH /api/auth/profile ───────────────────────────────────────────────────
// Update name and/or password. NIC and email are NOT editable.

router.patch('/profile', jwtOnly, async (req, res) => {
  const { name, currentPassword, newPassword } = req.body;

  const sets   = [];
  const params = [];
  const add    = (col, val) => { sets.push(`${col} = $${params.length + 1}`); params.push(val); };

  if (name !== undefined && name.trim()) add('name', name.trim());

  // Password change — requires currentPassword verification
  if (newPassword !== undefined) {
    if (!currentPassword) {
      return res.status(422).json({ error: 'currentPassword is required to set a new password.' });
    }
    if (newPassword.length < 6) {
      return res.status(422).json({ error: 'New password must be at least 6 characters.' });
    }

    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.userId]);
    const match = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(newPassword, 12);
    add('password_hash', newHash);
  }

  if (sets.length === 0) {
    return res.status(422).json({ error: 'No fields to update.' });
  }

  params.push(req.user.userId);

  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, email, nic`,
      params
    );
    return res.json({ message: 'Profile updated.', user: rows[0] });
  } catch (err) {
    console.error('PATCH /api/auth/profile:', err.message);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Server-side no-op — client discards the token.

router.post('/logout', (_req, res) => {
  res.json({ message: 'Logged out.' });
});

module.exports = router;
