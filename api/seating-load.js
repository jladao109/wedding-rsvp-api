import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  readGuestRows,
  norm,
  normLower,
} from "./_comm-helpers.js";

const SEATING_TAB = "Seating";

const TABLE_LAYOUTS = [
  { id: 1, x: 170, y: 175 },
  { id: 2, x: 325, y: 175 },
  { id: 3, x: 480, y: 175 },
  { id: 4, x: 170, y: 375 },
  { id: 5, x: 325, y: 375 },
  { id: 6, x: 480, y: 375 },
  { id: 7, x: 230, y: 610 },
  { id: 8, x: 390, y: 610 },
  { id: 9, x: 890, y: 175 },
  { id: 10, x: 1045, y: 175 },
  { id: 11, x: 1200, y: 175 },
  { id: 12, x: 890, y: 375 },
  { id: 13, x: 1045, y: 375 },
  { id: 14, x: 1200, y: 375 },
  { id: 15, x: 910, y: 610 },
  { id: 16, x: 1065, y: 610 },
  { id: 17, x: 1220, y: 610 },
  { id: 18, x: 1370, y: 610 },
].map((t) => ({ ...t, size: 10, seatAssignments: [] }));

function parseDelimitedList(cell, delimiter = ";") {
  return norm(cell)
    .split(delimiter)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseNameTriplet(nameStr) {
  const parts = String(nameStr ?? "")
    .split(",")
    .map((p) => p.trim());

  const lastName = parts[0] ?? "";
  const firstName = parts[1] ?? "";
  const suffix = parts[2] ?? "";
  const display = [firstName, lastName, suffix].filter(Boolean).join(" ").trim();
  const key = `${normLower(lastName)}|${normLower(firstName)}|${normLower(suffix)}`;
  const noSuffixKey = `${normLower(lastName)}|${normLower(firstName)}|`;

  return { lastName, firstName, suffix, display, key, noSuffixKey };
}

function parseComingNamesCell(value) {
  return parseDelimitedList(value, ";")
    .map(parseNameTriplet)
    .filter((p) => p.firstName || p.lastName);
}

function parseMealsCell(value) {
  return parseDelimitedList(value, ";")
    .map((entry) => {
      const parts = entry.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) return null;

      const lastName = parts[0] || "";
      const firstName = parts[1] || "";
      let suffix = "";
      let meal = "";

      if (parts.length === 3) {
        meal = parts[2] || "";
      } else {
        suffix = parts[2] || "";
        meal = parts.slice(3).join(", ").trim();
      }

      const key = `${normLower(lastName)}|${normLower(firstName)}|${normLower(suffix)}`;
      const noSuffixKey = `${normLower(lastName)}|${normLower(firstName)}|`;
      return { key, noSuffixKey, meal };
    })
    .filter(Boolean);
}

function parseAgesCell(value) {
  return parseDelimitedList(value, ";")
    .map((entry) => {
      const parts = entry.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length < 3) return null;

      const lastName = parts[0] || "";
      const firstName = parts[1] || "";
      let suffix = "";
      let ageRaw = "";

      if (parts.length === 3) {
        ageRaw = parts[2] || "";
      } else {
        suffix = parts[2] || "";
        ageRaw = parts.slice(3).join(", ").trim();
      }

      const age = /^\d+$/.test(ageRaw) ? Number(ageRaw) : null;
      const key = `${normLower(lastName)}|${normLower(firstName)}|${normLower(suffix)}`;
      const noSuffixKey = `${normLower(lastName)}|${normLower(firstName)}|`;
      return { key, noSuffixKey, age, ageRaw };
    })
    .filter(Boolean);
}

function mapByKeyWithFallback(arr) {
  const map = new Map();
  arr.forEach((item) => {
    map.set(item.key, item);
    if (!map.has(item.noSuffixKey)) {
      map.set(item.noSuffixKey, item);
    }
  });
  return map;
}

function guestIdFrom(partyId, display) {
  return `${norm(partyId)}__${normLower(display).replace(/[^a-z0-9]+/g, "-")}`;
}

async function readSeatingRows() {
  const sheets = await getSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SEATING_TAB}!A2:F`,
  });

  return (response.data.values || []).map((row, idx) => ({
    sheetRowNumber: idx + 2,
    name: norm(row[0]),
    partyId: norm(row[1]),
    mealPreference: norm(row[2]),
    child: norm(row[3]).toUpperCase(),
    childAge: norm(row[4]),
    table: norm(row[5]),
  }));
}

function buildNormalizedSeatingGuests(guestRows, existingSeatingRows) {
  const existingMap = new Map(
    existingSeatingRows.map((r) => [`${normLower(r.partyId)}|${normLower(r.name)}`, r])
  );

  const normalizedGuests = [];

  guestRows.forEach((row) => {
    if (row.rsvp !== "Y") return;

    const comingGuests = parseComingNamesCell(row.comingNames || "");
    const mealsMap = mapByKeyWithFallback(parseMealsCell(row.meals || ""));
    const agesMap = mapByKeyWithFallback(parseAgesCell(row.ages || ""));
    const role = norm(row.entourageGroup);
    const isBrideAndGroom = normLower(role) === "bride and groom";

    comingGuests.forEach((guest) => {
      const mealInfo = mealsMap.get(guest.key) || mealsMap.get(guest.noSuffixKey);
      const ageInfo = agesMap.get(guest.key) || agesMap.get(guest.noSuffixKey);
      const age = ageInfo?.age ?? null;
      const child = typeof age === "number" && age <= 12 ? "Y" : "N";
      const childAge = child === "Y" ? String(age) : "";
      const existing = existingMap.get(`${normLower(row.partyId)}|${normLower(guest.display)}`);

      let table = existing?.table || "";
      let fixedTable = "";
      if (isBrideAndGroom) {
        fixedTable = "SH";
        table = "SH";
      }

      normalizedGuests.push({
        id: guestIdFrom(row.partyId, guest.display),
        name: guest.display,
        partyId: row.partyId,
        mealPreference: mealInfo?.meal || "",
        child,
        childAge,
        table,
        fixedTable,
        role,
      });
    });
  });

  return normalizedGuests.sort((a, b) => {
    if (a.table === "SH" && b.table !== "SH") return -1;
    if (b.table === "SH" && a.table !== "SH") return 1;
    return a.name.localeCompare(b.name);
  });
}

async function syncSeatingTab(normalizedGuests) {
  const sheets = await getSheetsClient();
  const values = normalizedGuests.map((guest) => [
    guest.name,
    guest.partyId,
    guest.mealPreference,
    guest.child,
    guest.childAge,
    guest.table,
  ]);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SEATING_TAB}!A2:F`,
  });

  if (values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${SEATING_TAB}!A2:F${values.length + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    });
  }
}

function buildTables(normalizedGuests) {
  const tables = TABLE_LAYOUTS.map((t) => ({ ...t, seatAssignments: [] }));
  const tableMap = new Map(tables.map((t) => [String(t.id), t]));

  normalizedGuests.forEach((guest) => {
    const tableValue = norm(guest.table);
    if (!tableValue || tableValue === "SH") return;
    const table = tableMap.get(String(Number(tableValue)));
    if (!table) return;
    table.seatAssignments.push(guest.id);
  });

  return tables;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const guestRows = await readGuestRows();
    const existingSeatingRows = await readSeatingRows();
    const guests = buildNormalizedSeatingGuests(guestRows, existingSeatingRows);
    await syncSeatingTab(guests);
    const tables = buildTables(guests);

    return res.json({
      ok: true,
      guests,
      tables,
      meta: {
        totalGuests: guests.length,
        assignedGuests: guests.filter((g) => g.table && g.table !== "SH").length,
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("SEATING LOAD ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
