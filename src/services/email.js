// Email service — uses Resend HTTP API (works on HuggingFace, Vercel, Railway, etc.)
// Resend sends over HTTPS, unlike nodemailer/Gmail SMTP which is blocked by most cloud platforms.
// Sign up free at https://resend.com — 3,000 emails/month on free tier.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
// From address: on Resend free tier you can send from onboarding@resend.dev without a domain.
// Once you have a custom domain verified in Resend, change this to e.g. noreply@reefsense.com
const FROM_ADDRESS = process.env.RESEND_FROM ?? 'ReefSense <onboarding@resend.dev>';

/**
 * Send a 6-digit OTP verification email via Resend HTTP API.
 * @param {string} toEmail
 * @param {string} code
 */
async function sendVerificationEmail(toEmail, code) {
  if (!RESEND_API_KEY) {
    // Fallback: log the OTP to console if no API key is set (useful for local dev)
    console.warn(`[EMAIL] No RESEND_API_KEY set. OTP for ${toEmail}: ${code}`);
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to:   [toEmail],
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
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Resend API error ${res.status}: ${body.message ?? JSON.stringify(body)}`);
  }
}

module.exports = { sendVerificationEmail };
