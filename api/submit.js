import { google } from "googleapis";

const TAB_NAME = "Guests";

// Cutoff: March 7, 2026 11:59 PM PST = March 8, 2026 07:59 UTC
const CUTOFF_UTC = Date.parse("2026-03-08T07:59:00Z");

// Event details
const EVENT_TZID = "America/New_York";
const EVENT_DATE = "20260522"; // YYYYMMDD
const EVENT_START_LOCAL = `${EVENT_DATE}T180000`; // 6:00 PM EDT
const EVENT_END_LOCAL = `${EVENT_DATE}T230000`;   // 11:00 PM EDT

const EVENT_TITLE = "Yvette & Jason Wedding";
const EVENT_ORGANIZER_EMAIL = "rsvp@bigornia2ladao.com";
const EVENT_ORGANIZER_NAME = "Yvette & Jason";

const EVENT_LOCATION_LINES = [
  "The Clubhouse at Galloping Hill",
  "3 Golf Drive",
  "Kenilworth, NJ 07033",
];

const EVENT_URL = "https://bigornia2ladao.com/rsvp";
const EVENT_MAPS_URL =
  "https://www.google.com/maps/search/?api=1&query=" +
  encodeURIComponent("The Clubhouse at Galloping Hill, 3 Golf Drive, Kenilworth, NJ 07033");

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

function escapeIcsText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function dtstampUtc() {
  const iso = new Date().toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildVTimeZoneAmericaNewYork() {
  return [
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "X-LIC-LOCATION:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");
}

function buildWeddingIcs({ partyId }) {
  const uid = `yvette-jason-wedding-${escapeIcsText(partyId || "unknown")}-${Date.now()}@bigornia2ladao.com`;

  const description = [
    "Yvette & Jason Wedding",
    "",
    "RSVP / Updates:",
    EVENT_URL,
    "",
    "Google Maps:",
    EVENT_MAPS_URL
  ].join("\n");

  const location = EVENT_LOCATION_LINES.join("\n");

  const alarms = [
    // 1 day before — popup
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Wedding reminder (tomorrow)",
    "TRIGGER:-P1D",
    "END:VALARM",

    // 1 day before — audio (client-dependent)
    "BEGIN:VALARM",
    "ACTION:AUDIO",
    "TRIGGER:-P1D",
    "ATTACH;VALUE=URI:Basso",
    "END:VALARM",

    // 2 hours before — popup
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Wedding reminder (in 2 hours)",
    "TRIGGER:-PT2H",
    "END:VALARM",

    // 2 hours before — audio
    "BEGIN:VALARM",
    "ACTION:AUDIO",
    "TRIGGER:-PT2H",
    "ATTACH;VALUE=URI:Ping",
    "END:VALARM",
  ].join("\r\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//bigornia2ladao.com//Wedding RSVP//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    buildVTimeZoneAmericaNewYork(),
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstampUtc()}`,
    `SUMMARY:${escapeIcsText(EVENT_TITLE)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    `URL:${escapeIcsText(EVENT_URL)}`,
    `ORGANIZER;CN=${escapeIcsText(EVENT_ORGANIZER_NAME)}:MAILTO:${EVENT_ORGANIZER_EMAIL}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    `DTSTART;TZID=${EVENT_TZID}:${EVENT_START_LOCAL}`,
    `DTEND;TZID=${EVENT_TZID}:${EVENT_END_LOCAL}`,
    alarms,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

/**
 * Send confirmation email via Resend
 */
async function sendEmailIfConfigured({ to, bcc, subject, html, text, attachments }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return { skipped: true };

  const payload = { from, to, bcc, subject, html, text };
  if (attachments?.length) payload.attachments = attachments;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, details: body };
  }

  return { ok: true };
}

/* =========================
   MAIN HANDLER
========================= */

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
  const rsvpValue = norm(values.E); // Y / N
  const guestCount = norm(values.F);
  const mealsRaw = norm(values.H);

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

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

    /* ---------- EMAIL CONTENT ---------- */
    const isAccepting = rsvpValue === "Y";

    const openingText = isAccepting
      ? "Thank you for your RSVP — We’re so glad you’ll be joining us and can’t wait to see you!"
      : "Thank you for your RSVP — We’re sorry you won’t be able to join us.";

    const subject = `Yvette & Jason Wedding RSVP — Party ${partyId}`;

    const html = `
      <p><strong>${openingText}</strong></p>
      <p>
        <strong>Party ID:</strong> ${partyId}<br>
        <strong>Number of Guests Coming:</strong> ${guestCount}<br>
        <strong>Email:</strong> ${email}
      </p>
      ${isAccepting ? `<p><strong>Add to Calendar</strong> <em>(attached)</em></p>` : ""}
      <p>
        Need to make an update? Changes can be made until <strong>March 7, 2026</strong>.<br>
        <a href="${EVENT_URL}">bigornia2ladao.com/rsvp</a>
      </p>
      <p><strong>Yvette & Jason</strong></p>
    `;

    const text =
`${openingText}

Party ID: ${partyId}
Number of Guests Coming: ${guestCount}
Email: ${email}

${isAccepting ? "Add to Calendar (attached)\n" : ""}
Need to make an update? Changes can be made until March 7, 2026.
${EVENT_URL}

Yvette & Jason`;

    let attachments;
    if (isAccepting) {
      const ics = buildWeddingIcs({ partyId });
      attachments = [{
        filename: "Yvette-and-Jason-Wedding.ics",
        content: Buffer.from(ics, "utf8").toString("base64")
      }];
    }

    const emailResult = await sendEmailIfConfigured({
      to: email,
      bcc: [
        "rsvp@bigornia2ladao.com",
        "yvbigornia@gmail.com",
        "jason.ladao@gmail.com"
      ],
      subject,
      html,
      text,
      attachments
    });

    return res.json({
      ok: true,
      email,
      partyId,
      icsAttached: !!attachments,
      emailResult
    });
  } catch (err) {
    console.error("SUBMIT ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err)
    });
  }
}
