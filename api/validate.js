import { google } from "googleapis";

/**
 * Sheet format expected:
 * A = Party ID (optional)
 * B = Names  (e.g. "Smith, John, Jr; Smith, Jane"  suffix optional)
 * C = ZIPs   (e.g. "07001;07002" OR "07001")
 *
 * Update the range tab name if needed: "Guests!A2:C"
 */

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
  const parts = nameStr.split(",").map((p) => p.trim()).filter(Boolean);
  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? ""; // optional
  const display =
    [first, last].filter(Boolean).join(" ") + (suffix ? `, ${suffix}` : "");
  return { last, first, suffix, display: display.trim() };
}
function parseNamesCell(namesCell) {
  return parseDelimitedList(namesCell, ";")
    .map(parseNameTriplet)
    .filter((p) => p.last || p.first);
}
function parseZipsCell(zipsCell) {
  return parseDelimitedList(zipsCell, ";").map((z) => z.replace(/\s+/g, ""));
}

export default async function handler(req, res) {
  // ✅ CORS: allow only your real site(s)
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

  // Preflight
  if (req.method === "OPTIONS") return res.status(204).end();

  // Simple health check
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, version: "v3" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // Env var checks (helps avoid silent 500s)
  if (!process.env.SPREADSHEET_ID) {
    return res.status(500).json({ error: "Missing SPREADSHEET_ID env var" });
  }
  if (!process.env.GOOGLE_CREDENTIALS) {
    return res.status(500).json({ error: "Missing GOOGLE_CREDENTIALS env var" });
  }

  const lastNameInput = normLower(req.body?.lastName);
  const zipInput = norm(req.body?.zip).replace(/\s+/g, "");

  if (!lastNameInput || !zipInput) {
    return res.status(400).json({ error: "Please provide lastName and zip." });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "Guests!A2:C", // <-- change "Guests" if your tab name differs
    });

    const rows = response.data.values || [];

    const match = rows.find((row) => {
      const namesCell = row[1] ?? "";
      const zipsCell = row[2] ?? "";

      const zips = parseZipsCell(zipsCell);
      if (!zips.includes(zipInput)) return false;

      const people = parseNamesCell(namesCell);
      const lastNames = people.map((p) => normLower(p.last));

      return lastNames.includes(lastNameInput);
    });

    if (!match) return res.json({ valid: false });

    const partyId = match[0] ?? "";
    const people = parseNamesCell(match[1] ?? "");

    return res.json({
      valid: true,
      partyId,
      guests: people.map((p) => ({
        lastName: p.last,
        firstName: p.first,
        suffix: p.suffix,
        display: p.display,
      })),
    });
  } catch (err) {
    console.error("API ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
