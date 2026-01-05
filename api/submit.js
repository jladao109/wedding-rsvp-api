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
 */
async function sendEmailIfConfigured({ to, bcc, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { skipped: true };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      bcc,
      subject,
      html,
      text,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, details: body };
  }

  return { ok: true };
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (Date.now() > CUTOFF_UTC) {
    return res.status(403).json({ error: "Cutoff passed" });
  }

  const { rowNumber, values } = req.body || {};
  if (!rowNumber || !values) {
    return res.status(400).json({ error: "Missing rowNumber or values." });
  }

  const email = norm(values.J);
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const partyId = norm(values.PARTY_ID || "Unknown");
  const rsvpValue = norm(values.E); // Y or N
  const guestCount = norm(values.F);
  const mealsRaw = norm(values.H); // "Last, First, Suffix, Meal; ..."

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Write back to columns E–K
    const updates = [
      { range: `${TAB_NAME}!E${rowNumber}`, value: rsvpValue },
      { range: `${TAB_NAME}!F${rowNumber}`, value: guestCount },
      { range: `${TAB_NAME}!G${rowNumber}`, value: norm(values.G) },
      { range: `${TAB_NAME}!H${rowNumber}`, value: mealsRaw },
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

    // -------- Build meal list (only if RSVP = Y) --------
    let mealLinesHtml = "";
    let mealLinesText = "";

    if (rsvpValue === "Y" && mealsRaw) {
      mealsRaw.split(";").forEach(entry => {
      const rawParts = entry.split(",").map(p => p.trim()); // IMPORTANT: do NOT filter empties

      const last = rawParts[0] || "";
      const first = rawParts[1] || "";

      // Case A: "Last, First, Suffix, Meal..."
      // Case B: "Last, First, , Meal..." (blank suffix still creates a 4th part)
      // Case C: "Last, First, Meal..."  (no suffix)
      let meal = "";
      if (rawParts.length >= 4) {
        meal = rawParts.slice(3).join(", ").trim();
      } else if (rawParts.length >= 3) {
        meal = rawParts.slice(2).join(", ").trim();
      }

      if (!last || !first || !meal) return;

        mealLinesHtml += `<p><strong>${first} ${last}:</strong><br>Meal Preference: ${meal}</p>`;
        mealLinesText += `${first} ${last}:\nMeal Preference: ${meal}\n\n`;
      });
    }


    // -------- Email content --------
    const subject = `Yvette & Jason Wedding Confirmation — Party ${partyId}`;

    const text = `
Thank you! We received your response.

Party ID: ${partyId}
Number of Guests Coming: ${guestCount}
RSVP: ${rsvpValue === "Y" ? "Joyfully Accepts" : "Regretfully Declines"}
Email: ${email}

${mealLinesText}
If you need to make any changes, you have until March 7, 2026 to do so.

You can update your RSVP directly on the official website:
https://bigornia2ladao.com/rsvp

Thank you for your RSVP — we hope you can make it and can’t wait to see you!

Yvette & Jason
    `.trim();

    const html = `
      <p><strong>Thank you! We received your response.</strong></p>

      <p>
        <strong>Party ID:</strong> ${partyId}<br>
        <strong>Number of Guests Coming:</strong> ${guestCount}<br>
        <strong>RSVP:</strong> ${rsvpValue === "Y" ? "Joyfully Accepts" : "Regretfully Declines"}<br>
        <strong>Email:</strong> ${email}
      </p>

      ${mealLinesHtml}

      <p>
        If you need to make any changes, you have until
        <strong>March 7, 2026</strong> to do so.
      </p>

      <p>
        You can update your RSVP directly on the official website:<br>
        <a href="https://bigornia2ladao.com/rsvp">
          bigornia2ladao.com/rsvp
        </a>
      </p>

      <p>
        Thank you for your RSVP — we hope you can make it and can’t wait to see you!
      </p>

      <p>
        <strong>Yvette & Jason</strong>
      </p>
    `;

    const bcc = [
      "rsvp@bigornia2ladao.com",
      "yvbigornia@gmail.com",
      "jason.ladao@gmail.com",
    ];

    const emailResult = await sendEmailIfConfigured({
      to: email,
      bcc,
      subject,
      html,
      text,
    });

    return res.json({
      ok: true,
      email,
      partyId,
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
