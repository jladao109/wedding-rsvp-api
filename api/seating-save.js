import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  norm,
} from "./_comm-helpers.js";

const SEATING_TAB = "Seating";
const SEATING_TABLES_TAB = "Seating Tables";

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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;

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

    const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];
    const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];

    const seatingValues = guests.map((g) => [
      norm(g.name),
      norm(g.partyId),
      norm(g.mealPreference),
      norm(g.child),
      norm(g.childAge),
      norm(g.table),
      norm(g.seatIndex),
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

    const tableValues = tables.map((t) => [
      Number(t.id),
      Number(t.size) === 12 ? 12 : 10,
      Math.max(0, Number(t.seatCount || 0)),
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SEATING_TABLES_TAB}!A2:C`,
    });

    if (tableValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SEATING_TABLES_TAB}!A2:C`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: tableValues },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("SEATING SAVE ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
