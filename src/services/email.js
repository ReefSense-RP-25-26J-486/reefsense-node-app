// Email service — uses Nodemailer with Gmail SMTP.
// Requires SMTP_USER (Gmail address) and SMTP_PASS (Gmail App Password) in .env.
// To generate an App Password:
//   Google Account → Security → 2-Step Verification → App Passwords → Mail → Other

const nodemailer = require('nodemailer');

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = process.env.EMAIL_FROM_NAME ?? 'ReefSense';

/** Lazy-create the transporter so the module loads even without env vars. */
function createTransporter() {
  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error('SMTP_USER and SMTP_PASS must be set in .env');
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

/**
 * Send a 6-digit OTP verification email via Gmail SMTP.
 * @param {string} toEmail
 * @param {string} code
 */
async function sendVerificationEmail(toEmail, code) {
  if (!SMTP_USER || !SMTP_PASS) {
    // Development fallback — log OTP to console so testing is possible without email
    console.warn(`[EMAIL] No SMTP credentials set. OTP for ${toEmail}: ${code}`);
    return;
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from: `"${FROM_NAME}" <${SMTP_USER}>`,
    to: toEmail,
    subject: 'Your ReefSense Verification Code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#f0f5ff;border-radius:12px;">
        <h2 style="color:#517AAD;margin-bottom:8px;">ReefSense</h2>
        <p style="color:#333;font-size:15px;">
          Thanks for registering! Use the code below to verify your email address.
          This code expires in <strong>15 minutes</strong>.
        </p>
        <div style="font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;
                    padding:24px;background:#fff;border-radius:10px;margin:24px 0;color:#517AAD;">
          ${code}
        </div>
        <p style="color:#888;font-size:13px;">
          If you did not request this, you can safely ignore this email.
        </p>
      </div>
    `,
  });
}

module.exports = { sendVerificationEmail };
