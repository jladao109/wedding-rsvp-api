import { google } from "googleapis";

const TAB_NAME = "Guests";

// Cutoff: March 7, 2026 11:59 PM PST = March 8, 2026 07:59 UTC
const CUTOFF_UTC = Date.parse("2026-03-08T07:59:00Z");

function norm(s) { return String(s ?? "").trim(); }
function normLower(s) { return norm(s).toLowerCase(); }

function splitList(cell, delim = ";") {
  return norm(cell).split(delim).map(x => x.trim()).filter(Boolean);
}
function parseZipsCell(zipsCell) {
  return splitList(zipsCell, ";").map(z => z.replace(/\s+/g, ""));
}
function parseNameTriplet(nameStr) {
  const parts = nameStr.split(",").map(p => p.trim()).filter(Boolean);
  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? "";
  const display = [first, last, suffix].filter(Boolean).join(" ");
  return { lastName: last, firstName: first, suffix, display };
}
function parseNamesCell(namesCell) {
  return splitList(namesCell, ";").map(parseNameTriplet).filter(p => p.lastName || p.firstName);
}

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = new Set(["https://bigornia2ladao.com", "https://www.bigornia2ladao.com"]);
  if (allowed.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    return res.status(200).json({ ok: true, version: "v-prefill-validate" });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  if (Date.now() > CUTOFF_UTC) {
    return res.status(200).json({ cutoffPassed: true, valid: false, matches: [] });
  }

  if (!process.env.SPREADSHEET_ID) return res.status(500).json({ error: "Missing SPREADSHEET_ID env var" });
  if (!process.env.GOOGLE_CREDENTIALS) return res.status(500).json({ error: "Missing GOOGLE_CREDENTIALS env var" });

  const lastNameInput = normLower(req.body?.lastName);
  const zipInputRaw = norm(req.body?.zip);
  const zipInput = zipInputRaw.replace(/\s+/g, "");

  if (!lastNameInput) return res.status(400).json({ error: "Please provide lastName." });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    // A=PartyId, B=Names, C=Zips, D=Seats, E..K saved RSVP fields
    const range = `${TAB_NAME}!A2:K`;
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range,
    });

    const rows = response.data.values || [];

    const matches = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const partyId = row[0] ?? "";
      const namesCell = row[1] ?? "";
      const zipsCell = row[2] ?? "";
      const seats = row[3] ?? "";

      // Saved (E..K)
      const attending = row[4] ?? "";     // E
      const countComing = row[5] ?? "";   // F
      const comingList = row[6] ?? "";    // G
      const mealsList = row[7] ?? "";     // H
      const agesList = row[8] ?? "";      // I
      const email = row[9] ?? "";         // J
      const phone = row[10] ?? "";        // K

      const people = parseNamesCell(namesCell);
      const lastNames = people.map(p => normLower(p.lastName));
      if (!lastNames.includes(lastNameInput)) continue;

      // ZIP optional: if blank, don't filter on ZIP
      if (zipInput) {
        const zips = parseZipsCell(zipsCell);
        if (!zips.includes(zipInput)) continue;
      }

      const rowNumber = i + 2; // A2 is first data row

      matches.push({
        rowNumber,
        partyId,
        seatsReserved: seats,
        guests: people,
        saved: {
          attending,
          countComing,
          comingList,
          mealsList,
          agesList,
          email,
          phone,
        },
      });
    }

    return res.json({
      cutoffPassed: false,
      valid: matches.length > 0,
      matches,
    });
  } catch (err) {
    console.error("VALIDATE ERROR:", err);
    return res.status(500).json({ error: "Server error", details: err?.message || String(err) });
  }
}
