// Email service — uses Brevo HTTP API (works on HuggingFace, Vercel, Railway, etc.)
// Brevo sends over HTTPS (port 443), no domain verification required.
// Sign up free at https://brevo.com — 300 emails/day on free tier.

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL    = process.env.BREVO_FROM_EMAIL ?? 'senithudara0000@gmail.com';
const FROM_NAME     = process.env.BREVO_FROM_NAME  ?? 'ReefSense';

/**
 * Send a 6-digit OTP verification email via Brevo HTTP API.
 * @param {string} toEmail
 * @param {string} code
 */
async function sendVerificationEmail(toEmail, code) {
  if (!BREVO_API_KEY) {
    // Fallback: log the OTP to console if no API key is set (useful for local dev)
    console.warn(`[EMAIL] No BREVO_API_KEY set. OTP for ${toEmail}: ${code}`);
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key':      BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: toEmail }],
      subject: 'Your ReefSense Verification Code',
      htmlContent: `
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
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Brevo API error ${res.status}: ${body.message ?? JSON.stringify(body)}`);
  }
}

module.exports = { sendVerificationEmail };
