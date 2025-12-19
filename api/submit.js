import { google } from "googleapis";

const TAB_NAME = "Guests";

// Cutoff: March 7, 2026 11:59 PM PST = March 8, 2026 07:59 UTC
const CUTOFF_UTC = Date.parse("2026-03-08T07:59:00Z");

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = new Set([
    "https://bigornia2ladao.com",
    "https://www.bigornia2ladao.com"
  ]);
  if (allowed.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function norm(s) {
  return String(s ?? "").trim();
}

/**
 * Send confirmation email via Resend (if configured)
 * Env vars required:
 * - RESEND_API_KEY
 * - RESEND_FROM (e.g. rsvp@bigornia2ladao.com)
 */
async function sendEmailIfConfigured({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { skipped: true };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { skipped: false, ok: false, details: body };
  }
  return { skipped: false, ok: true };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (Date.now() > CUTOFF_UTC) {
    return res.status(403).json({ error: "Cutoff passed" });
  }

  if (!process.env.SPREADSHEET_ID) {
    return res.status(500).json({ error: "Missing SPREADSHEET_ID env var" });
  }
  if (!process.env.GOOGLE_CREDENTIALS) {
    return res.status(500).json({ error: "Missing GOOGLE_CREDENTIALS env var" });
  }

  const rowNumber = Number(req.body?.rowNumber);
  const values = req.body?.values;

  if (!rowNumber || !values) {
    return res.status(400).json({ error: "Missing rowNumber or values." });
  }

  const email = norm(values.J);
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Write back to columns E–K
    const updates = [
      { range: `${TAB_NAME}!E${rowNumber}`, value: norm(values.E) },
      { range: `${TAB_NAME}!F${rowNumber}`, value: norm(values.F) },
      { range: `${TAB_NAME}!G${rowNumber}`, value: norm(values.G) },
      { range: `${TAB_NAME}!H${rowNumber}`, value: norm(values.H) },
      { range: `${TAB_NAME}!I${rowNumber}`, value: norm(values.I) },
      { range: `${TAB_NAME}!J${rowNumber}`, value: email },
      { range: `${TAB_NAME}!K${rowNumber}`, value: norm(values.K) },
    ];

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates.map(u => ({
          range: u.range,
          values: [[u.value]],
        })),
      },
    });

    // ✅ UPDATED CONFIRMATION EMAIL COPY
    const subject = "Yvette & Jason Wedding Confirmation";

    const text =
      "Thank you! We received your response. If you need to make any changes, you have until March 7, 2026 to do so. " +
      "You can update your RSVP directly on the official website (https://bigornia2ladao.com/rsvp).";

    const html = `
      <p>Thank you! We received your response.</p>
      <p>
        If you need to make any changes, you have until <strong>March 7, 2026</strong> to do so.
      </p>
      <p>
        You can update your RSVP directly on the official website:
        <a href="https://bigornia2ladao.com/rsvp">
          bigornia2ladao.com/rsvp
        </a>
      </p>
    `;

    const emailResult = await sendEmailIfConfigured({
      to: email,
      subject,
      text,
      html,
    });

    return res.json({
      ok: true,
      email,
      emailResult,
    });
  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
