import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  readGuestRows,
  norm,
  normLower,
} from "./_comm-helpers.js";

const SEATING_TAB = "Seating";
const SEATING_TABLES_TAB = "Seating Tables";

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

  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? "";

  const display = [first, last, suffix].filter(Boolean).join(" ").trim();
  const key = [normLower(last), normLower(first), normLower(suffix)].join("|");
  const noSuffixKey = [normLower(last), normLower(first), ""].join("|");

  return {
    lastName: last,
    firstName: first,
    suffix,
    display,
    key,
    noSuffixKey,
  };
}

function parseComingNamesCell(comingNamesCell) {
  return parseDelimitedList(comingNamesCell, ";")
    .map(parseNameTriplet)
    .filter((p) => p.firstName || p.lastName);
}

function parseMealsCell(mealsCell) {
  const entries = parseDelimitedList(mealsCell, ";");

  return entries
    .map((entry) => {
      const parts = entry.split(",").map((p) => p.trim());
      const cleaned = parts.filter((p) => p !== "");
      if (cleaned.length < 3) return null;

      const lastName = cleaned[0] || "";
      const firstName = cleaned[1] || "";

      let suffix = "";
      let meal = "";

      if (cleaned.length === 3) {
        meal = cleaned[2] || "";
      } else {
        suffix = cleaned[2] || "";
        meal = cleaned.slice(3).join(", ").trim();
      }

      const key = [normLower(lastName), normLower(firstName), normLower(suffix)].join("|");
      const noSuffixKey = [normLower(lastName), normLower(firstName), ""].join("|");

      return {
        lastName,
        firstName,
        suffix,
        meal,
        display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
        key,
        noSuffixKey,
      };
    })
    .filter(Boolean);
}

function parseAgesCell(agesCell) {
  const entries = parseDelimitedList(agesCell, ";");

  return entries
    .map((entry) => {
      const parts = entry.split(",").map((p) => p.trim());
      const cleaned = parts.filter((p) => p !== "");
      if (cleaned.length < 3) return null;

      const lastName = cleaned[0] || "";
      const firstName = cleaned[1] || "";

      let suffix = "";
      let ageRaw = "";

      if (cleaned.length === 3) {
        ageRaw = cleaned[2] || "";
      } else {
        suffix = cleaned[2] || "";
        ageRaw = cleaned.slice(3).join(", ").trim();
      }

      const age = /^\d+$/.test(ageRaw) ? Number(ageRaw) : null;
      const key = [normLower(lastName), normLower(firstName), normLower(suffix)].join("|");
      const noSuffixKey = [normLower(lastName), normLower(firstName), ""].join("|");

      return {
        lastName,
        firstName,
        suffix,
        age,
        ageRaw,
        display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
        key,
        noSuffixKey,
      };
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

async function ensureTabExistsWithHeaders(sheets, spreadsheetId, tabName, headers) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === tabName
  );

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: tabName },
            },
          },
        ],
      },
    });
  }

  const lastCol = String.fromCharCode(64 + headers.length);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:${lastCol}1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [headers] },
  });
}

function buildComingGuests(rows) {
  const guests = [];

  rows.forEach((row) => {
    if (row.rsvp !== "Y") return;

    const comingGuests = parseComingNamesCell(row.comingNames || "");
    const mealsMap = mapByKeyWithFallback(parseMealsCell(row.meals || ""));
    const agesMap = mapByKeyWithFallback(parseAgesCell(row.ages || ""));

    comingGuests.forEach((guest) => {
      const mealInfo =
        mealsMap.get(guest.key) ||
        mealsMap.get(guest.noSuffixKey);

      const ageInfo =
        agesMap.get(guest.key) ||
        agesMap.get(guest.noSuffixKey);

      const age = ageInfo?.age ?? null;
      const child = typeof age === "number" && age <= 12 ? "Y" : "N";

      guests.push({
        id: `${row.partyId}__${guest.key}`,
        name: guest.display,
        partyId: row.partyId,
        mealPreference: mealInfo?.meal || "",
        child,
        childAge: child === "Y" ? String(age ?? "") : "",
        table: "",
        seatIndex: "",
      });
    });
  });

  return guests;
}

function buildDefaultTables() {
  const positions = [
    { x: 245, y: 190 },  // 1
    { x: 450, y: 190 },  // 2
    { x: 600, y: 190 },  // 3

    { x: 245, y: 405 },  // 4
    { x: 450, y: 405 },  // 5
    { x: 600, y: 405 },  // 6

    { x: 235, y: 665 },  // 7
    { x: 445, y: 665 },  // 8

    { x: 845, y: 190 },  // 9
    { x: 1000, y: 190 }, // 10
    { x: 1155, y: 190 }, // 11

    { x: 845, y: 405 },  // 12
    { x: 1000, y: 405 }, // 13
    { x: 1155, y: 405 }, // 14

    { x: 845, y: 650 },  // 15
    { x: 1000, y: 650 }, // 16
    { x: 1155, y: 650 }, // 17
    { x: 1275, y: 720 }, // 18
  ];

  return Array.from({ length: 18 }, (_, i) => ({
    id: i + 1,
    x: positions[i].x,
    y: positions[i].y,
    size: 10,
    seatCount: 0,
  }));
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const sheets = await getSheetsClient();

    await ensureTabExistsWithHeaders(
      sheets,
      spreadsheetId,
      SEATING_TAB,
      ["Name", "Party ID", "Meal Preference", "Child", "Child Age", "Table", "Seat Index"]
    );

    await ensureTabExistsWithHeaders(
      sheets,
      spreadsheetId,
      SEATING_TABLES_TAB,
      ["Table", "Size", "Seat Count"]
    );

    const guestRows = await readGuestRows();
    const comingGuests = buildComingGuests(guestRows);

    const seatingRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SEATING_TAB}!A2:G`,
    });

    const seatingRows = seatingRes.data.values || [];

    const seatingMap = new Map(
      seatingRows.map((r) => {
        const name = norm(r[0]);
        const partyId = norm(r[1]);
        return [
          `${partyId}__${normLower(name)}`,
          {
            table: norm(r[5]),
            seatIndex: norm(r[6]),
          },
        ];
      })
    );

    const mergedGuests = comingGuests.map((g) => ({
      ...g,
      table: seatingMap.get(`${g.partyId}__${normLower(g.name)}`)?.table || "",
      seatIndex: seatingMap.get(`${g.partyId}__${normLower(g.name)}`)?.seatIndex || "",
    }));

    const seatingValues = mergedGuests.map((g) => [
      g.name,
      g.partyId,
      g.mealPreference,
      g.child,
      g.childAge,
      g.table,
      g.seatIndex,
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SEATING_TAB}!A2:G`,
    });

    if (seatingValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SEATING_TAB}!A2:G`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: seatingValues },
      });
    }

    const tablesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SEATING_TABLES_TAB}!A2:C`,
    });

    const tableRows = tablesRes.data.values || [];

    const tableMetaMap = new Map(
      tableRows
        .map((r) => [
          Number(r[0]),
          {
            size: Number(r[1]),
            seatCount: Number(r[2]),
          },
        ])
        .filter(([id, meta]) =>
          Number.isFinite(id) &&
          Number.isFinite(meta.size) &&
          Number.isFinite(meta.seatCount)
        )
    );

    const tables = buildDefaultTables().map((t) => ({
      ...t,
      size: tableMetaMap.get(t.id)?.size === 12 ? 12 : 10,
      seatCount: Number.isFinite(tableMetaMap.get(t.id)?.seatCount)
        ? Math.max(0, tableMetaMap.get(t.id).seatCount)
        : 0,
    }));

    const tableSheetValues = tables.map((t) => [t.id, t.size, t.seatCount]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SEATING_TABLES_TAB}!A2:C`,
    });

    if (tableSheetValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SEATING_TABLES_TAB}!A2:C`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: tableSheetValues },
      });
    }

    return res.json({
      ok: true,
      guests: mergedGuests,
      tables,
    });
  } catch (err) {
    console.error("SEATING LOAD ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
