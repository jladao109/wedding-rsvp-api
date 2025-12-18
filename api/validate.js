import { google } from "googleapis";

export default async function handler(req, res) {
  const origin = req.headers.origin;

  // Allow only your real site(s)
  const allowedOrigins = new Set([
    "https://bigornia2ladao.com",
    "https://www.bigornia2ladao.com"
  ]);

  // IMPORTANT: Always return CORS headers for BOTH OPTIONS and POST
  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  // ...rest of your existing code...
}

/**
 * Expected Google Sheet columns (starting row 2):
 * A = Party ID (optional)
 * B = Names  (e.g. "Smith, John, Jr; Smith, Jane"  suffix optional)
 * C = ZIPs   (e.g. "07001;07002" OR "07001")
 *
 * Update RANGE and column indexes if your sheet differs.
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

/**
 * Parses a single name string like:
 *  "LAST, FIRST, SUFFIX"
 *  "LAST, FIRST"
 *  "LAST, FIRST M."
 * Returns { last, first, suffix, display }
 */
function parseNameTriplet(nameStr) {
  const parts = nameStr.split(",").map((p) => p.trim()).filter(Boolean);

  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? ""; // optional

  const display = [first, last].filter(Boolean).join(" ") + (suffix ? `, ${suffix}` : "");
  return { last, first, suffix, display: display.trim() };
}

function parseNamesCell(namesCell) {
  // Split people by ";", then parse each person by ","
  const people = parseDelimitedList(namesCell, ";").map(parseNameTriplet);

  // Filter out garbage entries (missing last+first)
  return people.filter((p) => p.last || p.first);
}

function parseZipsCell(zipsCell) {
  // Split by ";" and normalize zips (keep leading zeros!)
  // Also remove spaces and allow ZIP+4, but compare on exact normalized input.
  return parseDelimitedList(zipsCell, ";").map((z) => z.replace(/\s+/g, ""));
}

export default async function handler(req, res) {
  // CORS (optional but helpful if you call from a different domain)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

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

    // 🔧 Change tab name/range if needed
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: "Guests!A2:C",
    });

    const rows = response.data.values || [];

    // Find the first row where:
    // - zipInput matches any ZIP in column C
    // - lastNameInput matches any person's LAST name inside column B
    const match = rows.find((row) => {
      const partyId = row[0] ?? "";
      const namesCell = row[1] ?? "";
      const zipsCell = row[2] ?? "";

      const zips = parseZipsCell(zipsCell);
      if (!zips.includes(zipInput)) return false;

      const people = parseNamesCell(namesCell);
      const lastNames = people.map((p) => normLower(p.last));

      return lastNames.includes(lastNameInput);
    });

    if (!match) {
      return res.json({ valid: false });
    }

    const partyId = match[0] ?? "";
    const people = parseNamesCell(match[1] ?? "");
    const zips = parseZipsCell(match[2] ?? "");

    return res.json({
      valid: true,
      partyId,
      // Return structured people for your UI:
      guests: people.map((p) => ({
        lastName: p.last,
        firstName: p.first,
        suffix: p.suffix,
        display: p.display, // e.g. "John Smith, Jr"
      })),
      // Optional: return zips (you can remove this if you prefer)
      zips,
    });
  } catch (err) {
      console.error(err);
      return res.status(500).json({
        error: "Server error",
        details: err?.message || String(err)
      });
  }
}
