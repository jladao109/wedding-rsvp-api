import { google } from "googleapis";

const TAB_NAME = "Guests";

/** ---------- helpers ---------- **/
function norm(s) {
  return String(s ?? "").trim();
}
function normLower(s) {
  return norm(s).toLowerCase();
}
function parseDelimitedList(cell, delimiter = ";") {
  return norm(cell)
    .split(delimiter)
    .map((x) => x.trim())
    .filter(Boolean);
}
function parseNameTriplet(nameStr) {
  const parts = String(nameStr ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? "";

  const display = [first, last].filter(Boolean).join(" ") + (suffix ? ` ${suffix}` : "");
  return { last, first, suffix, display: display.trim() };
}
function parseNamesCell(namesCell) {
  const people = parseDelimitedList(namesCell, ";").map(parseNameTriplet);
  return people.filter((p) => p.last || p.first);
}
function parseZipsCell(zipsCell) {
  return parseDelimitedList(zipsCell, ";").map((z) => z.replace(/\s+/g, ""));
}

// Parse "March 7, 2026" -> {y,m,d}  (month 1-12)
function parseMonthDayYear(dateStr) {
  const s = norm(dateStr);
  if (!s) return null;

  // Try Date.parse first (handles many Sheet formats)
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    // Use UTC parts from parsed Date (safe as a *date*, we'll convert later)
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  // Fallback for "Month D, YYYY"
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

// Convert a local time in a named timezone to UTC ms using Intl (no extra libs)
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

  // Start with a UTC guess
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const guessDate = new Date(utcGuess);

  // See what the formatter says the "local time" would be for that UTC guess
  const p = partsToObj(guessDate);
  const asIfUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second)
  );

  // Offset between guess and desired
  const offsetMs = asIfUtc - utcGuess;
  return utcGuess - offsetMs;
}

// Column L cutoff is a date; cutoff moment is 11:59 PM America/Los_Angeles on that date
function cutoffUtcMsFromSheetValue(cutoffDateStr) {
  const parts = parseMonthDayYear(cutoffDateStr);
  if (!parts) return null;

  return zonedTimeToUtcMs(
    { ...parts, hh: 23, mm: 59, ss: 0 },
    "America/Los_Angeles"
  );
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowedOrigins = new Set([
    "https://bigornia2ladao.com",
    "https://www.bigornia2ladao.com",
  ]);

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

/** ---------- handler ---------- **/
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, version: "v_dynamic_cutoff" });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (!process.env.SPREADSHEET_ID) return res.status(500).json({ error: "Missing SPREADSHEET_ID env var" });
  if (!process.env.GOOGLE_CREDENTIALS) return res.status(500).json({ error: "Missing GOOGLE_CREDENTIALS env var" });

  const lastNameInput = normLower(req.body?.lastName);
  const zipInput = norm(req.body?.zip).replace(/\s+/g, "");

  if (!lastNameInput) {
    return res.status(400).json({ error: "Please provide lastName." });
  }
  // zip can be blank
  const zipProvided = !!zipInput;

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Read through column L now (A..L)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${TAB_NAME}!A2:L`,
    });

    const rows = response.data.values || [];

    const matches = [];
    rows.forEach((row, idx) => {
      // Real sheet row number (since we started at A2)
      const rowNumber = idx + 2;

      const partyId = row[0] ?? "";
      const namesCell = row[1] ?? "";
      const zipsCell = row[2] ?? "";
      const seatsReserved = row[3] ?? ""; // D
      const rsvpYN = row[4] ?? "";         // E
      const countComing = row[5] ?? "";    // F
      const comingNames = row[6] ?? "";    // G
      const meals = row[7] ?? "";          // H
      const ages = row[8] ?? "";           // I
      const email = row[9] ?? "";          // J
      const phone = row[10] ?? "";         // K
      const cutoffDate = row[11] ?? "";    // L

      const people = parseNamesCell(namesCell);
      const lastNames = people.map((p) => normLower(p.last));

      if (!lastNames.includes(lastNameInput)) return;

      if (zipProvided) {
        const zips = parseZipsCell(zipsCell);
        if (!zips.includes(zipInput)) return;
      }

      const cutoffUtcMs = cutoffUtcMsFromSheetValue(cutoffDate);

      matches.push({
        rowNumber,
        partyId: norm(partyId),
        seatsReserved: norm(seatsReserved),
        rsvpYN: norm(rsvpYN),
        countComing: norm(countComing),
        comingNames: norm(comingNames),
        meals: norm(meals),
        ages: norm(ages),
        email: norm(email),
        phone: norm(phone),
        cutoffDate: norm(cutoffDate),   // display string like "March 7, 2026"
        cutoffUtcMs: cutoffUtcMs ?? null,
        guests: people.map((p) => ({
          lastName: p.last,
          firstName: p.first,
          suffix: p.suffix,
          display: p.display,
        })),
      });
    });

    if (!matches.length) {
      return res.json({ valid: false, matches: [] });
    }

    // If cutoffUtcMs is available, also include a boolean to help the UI
    const now = Date.now();
    matches.forEach((m) => {
      m.cutoffPassed = m.cutoffUtcMs ? now > m.cutoffUtcMs : false;
    });

    return res.json({
      valid: true,
      matches,
    });
  } catch (err) {
    console.error("VALIDATE ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
