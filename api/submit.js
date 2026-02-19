import { google } from "googleapis";

const TAB_NAME = "Guests";

// Event details (same as your current)
const EVENT_TZID = "America/New_York";
const EVENT_DATE = "20260522";
const EVENT_START_LOCAL = `${EVENT_DATE}T180000`;
const EVENT_END_LOCAL = `${EVENT_DATE}T230000`;

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

/** ---------- shared helpers ---------- **/
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

// "March 7, 2026" -> {y,m,d} (month 1-12)
function parseMonthDayYear(dateStr) {
  const s = norm(dateStr);
  if (!s) return null;

  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!m) return null;
  const monthName = m[1].toLowerCase();
  const day = Number(m[2]);
  const year = Number(m[3]);
  const monthMap = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const month = monthMap[monthName];
  if (!month || !day || !year) return null;
  return { y: year, m: month, d: day };
}

// Convert local time in a named TZ to UTC ms (no extra libs)
function zonedTimeToUtcMs({ y, m, d, hh, mm, ss }, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const partsToObj = (date) =>
    Object.fromEntries(
      dtf
        .formatToParts(date)
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value])
    );

  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const guessDate = new Date(utcGuess);

  const p = partsToObj(guessDate);
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );

  const offsetMs = asIfUtc - utcGuess;
  return utcGuess - offsetMs;
}

// Column L date => cutoff moment is 11:59 PM America/Los_Angeles on that date
function cutoffUtcMsFromSheetValue(cutoffDateStr) {
  const parts = parseMonthDayYear(cutoffDateStr);
  if (!parts) return null;
  return zonedTimeToUtcMs(
    { ...parts, hh: 23, mm: 59, ss: 0 },
    "America/Los_Angeles"
  );
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
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Wedding reminder (tomorrow)",
    "TRIGGER:-P1D",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:AUDIO",
    "TRIGGER:-P1D",
    "ATTACH;VALUE=URI:Basso",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Wedding reminder (in 2 hours)",
    "TRIGGER:-PT2H",
    "END:VALARM",
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

/** ---------- handler ---------- **/
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!process.env.SPREADSHEET_ID) return res.status(500).json({ error: "Missing SPREADSHEET_ID env var" });
  if (!process.env.GOOGLE_CREDENTIALS) return res.status(500).json({ error: "Missing GOOGLE_CREDENTIALS env var" });

  const rowNumber = Number(req.body?.rowNumber);
  const values = req.body?.values;

  if (!rowNumber || !values) {
    return res.status(400).json({ error: "Missing rowNumber or values." });
  }

  const email = norm(values.J);
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  const partyId = norm(values.PARTY_ID || "Unknown");
  const rsvpValue = norm(values.E); // Y/N
  const guestCount = norm(values.F);
  const mealsRaw = norm(values.H);

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    // ✅ Read cutoff date from Column L for THIS row before accepting submit
    const cutoffRead = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${TAB_NAME}!L${rowNumber}`,
    });

    const cutoffDateStr = norm(cutoffRead.data.values?.[0]?.[0] ?? "");
    const cutoffUtcMs = cutoffUtcMsFromSheetValue(cutoffDateStr);

    if (cutoffUtcMs && Date.now() > cutoffUtcMs) {
      return res.status(403).json({
        error: "Cutoff passed",
        cutoffDate: cutoffDateStr || null,
      });
    }

    // Write E–K
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
        data: updates.map(u => ({ range: u.range, values: [[u.value]] })),
      },
    });

    // Meal table rows (email-safe)
    const isAccepting = rsvpValue === "Y";
    const mealRows = [];
    if (isAccepting && mealsRaw) {
      mealsRaw.split(";").forEach(entry => {
        const rawParts = entry.split(",").map(p => p.trim());
        const last = rawParts[0] || "";
        const first = rawParts[1] || "";

        let suffix = "";
        let meal = "";

        if (rawParts.length >= 4) {
          suffix = rawParts[2] || "";
          meal = rawParts.slice(3).join(", ").trim();
        } else if (rawParts.length === 3) {
          suffix = "";
          meal = rawParts[2] || "";
        }

        if (!last || !first || !meal) return;
        const nameLine = `${first} ${last}${suffix ? " " + suffix : ""}`.trim();
        mealRows.push({ nameLine, meal });
      });
    }

    const mealTableHtml = (isAccepting && mealRows.length)
      ? `
        <div style="margin:16px 0;">
          <div style="font-family:Arial, sans-serif; font-size:14px; font-weight:700; color:#111; margin-bottom:8px;">
            Meal Selections
          </div>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
            style="border-collapse:collapse; width:100%; max-width:640px; border:1px solid #e7e7e7; border-radius:8px; overflow:hidden;">
            <thead>
              <tr>
                <th align="left" style="padding:10px 12px; background:#f6f6f6; border-bottom:1px solid #e7e7e7; font-family:Arial, sans-serif; font-size:13px; color:#444;">
                  Guest
                </th>
                <th align="left" style="padding:10px 12px; background:#f6f6f6; border-bottom:1px solid #e7e7e7; font-family:Arial, sans-serif; font-size:13px; color:#444;">
                  Meal
                </th>
              </tr>
            </thead>
            <tbody>
              ${mealRows.map(r => `
                <tr>
                  <td style="padding:10px 12px; border-bottom:1px solid #e7e7e7; font-weight:600; font-family:Arial, sans-serif; font-size:14px; color:#111;">
                    ${r.nameLine}
                  </td>
                  <td style="padding:10px 12px; border-bottom:1px solid #e7e7e7; font-family:Arial, sans-serif; font-size:14px; color:#111;">
                    ${r.meal}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `
      : "";

    const mealText = (isAccepting && mealRows.length)
      ? mealRows.map(r => `${r.nameLine}\n${r.meal}`).join("\n\n") + "\n\n"
      : "";

    // ✅ Dynamic cutoff string used in email
    const cutoffDisplay = cutoffDateStr || "your RSVP cutoff date";

    const openingText = isAccepting
      ? "Thank you for your RSVP — We’re so glad you’ll be joining us and can’t wait to see you!"
      : "Thank you for your RSVP — We’re sorry you won’t be able to join us.";

    const subject = `Yvette & Jason Wedding RSVP — Party ${partyId}`;

    const calendarNoteHtml = isAccepting
      ? `<div style="margin:12px 0; font-family:Arial, sans-serif; font-size:14px; color:#111;"><strong>Add to Calendar</strong> <span style="color:#666;">(attached)</span></div>`
      : "";
    const calendarNoteText = isAccepting ? "Add to Calendar (attached)\n\n" : "";

    const html = `
      <div style="font-family:Arial, sans-serif; color:#111; font-size:14px; line-height:1.45;">
        <div style="font-size:16px; font-weight:700; margin-bottom:12px;">${openingText}</div>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse; max-width:640px;">
          <tr><td style="padding:0 0 6px 0;"><strong>Party ID:</strong> ${partyId}</td></tr>
          <tr><td style="padding:0 0 6px 0;"><strong>Number of Guests Coming:</strong> ${guestCount}</td></tr>
          <tr><td style="padding:0 0 6px 0;"><strong>Email:</strong> ${email}</td></tr>
        </table>

        ${calendarNoteHtml}
        ${mealTableHtml}

        <div style="margin-top:16px;">
          <div style="margin-bottom:10px;">
            <em>Need to make an update?</em> Changes can be made until <strong>${cutoffDisplay}</strong>.
          </div>
          <div style="margin-bottom:14px;">
            You can update your RSVP directly on the official website:<br>
            <a href="${EVENT_URL}" style="color:#0b57d0; text-decoration:underline;">bigornia2ladao.com/rsvp</a>
          </div>
          <div style="font-weight:700;">Yvette & Jason</div>
        </div>
      </div>
    `;

    const text = `
${openingText}

Party ID: ${partyId}
Number of Guests Coming: ${guestCount}
Email: ${email}

${calendarNoteText}${mealText}Need to make an update? Changes can be made until ${cutoffDisplay}.
${EVENT_URL}

Yvette & Jason
    `.trim();

    // Attach ICS only if accepting
    let attachments;
    if (isAccepting) {
      const ics = buildWeddingIcs({ partyId });
      attachments = [{
        filename: "Yvette-and-Jason-Wedding.ics",
        content: Buffer.from(ics, "utf8").toString("base64"),
      }];
    }

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
      attachments,
    });

    return res.json({
      ok: true,
      email,
      partyId,
      cutoffDate: cutoffDateStr || null,
      icsAttached: !!attachments?.length,
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
