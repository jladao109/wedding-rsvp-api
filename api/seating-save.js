import {
  setCors,
  requireAdminKey,
  getSheetsClient,
} from "./_comm-helpers.js";

const SEATING_TAB = "Seating";
const SEATING_TABLES_TAB = "Seating Tables";

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.SPREADSHEET_ID;

    const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];
    const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];

    const seatingValues = guests.map((g) => [
      g.name || "",
      g.partyId || "",
      g.mealPreference || "",
      g.child || "",
      g.childAge || "",
      g.table || "",
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SEATING_TAB}!A2:F`,
    });

    if (seatingValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SEATING_TAB}!A2:F`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: seatingValues },
      });
    }

    const tableValues = tables.map((t) => [t.id, t.size]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${SEATING_TABLES_TAB}!A2:B`,
    });

    if (tableValues.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${SEATING_TABLES_TAB}!A2:B`,
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
