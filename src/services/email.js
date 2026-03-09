
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Send a 6-digit OTP verification email.
 * @param {string} toEmail
 * @param {string} code
 */
async function sendVerificationEmail(toEmail, code) {
  await transporter.sendMail({
    from: `"ReefSense" <${process.env.SMTP_USER}>`,
    to:   toEmail,
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
