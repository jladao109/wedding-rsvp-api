import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  norm,
} from "./_comm-helpers.js";

const SEATING_TAB = "Seating";

function normalizeGuest(input) {
  return {
    name: norm(input?.name),
    partyId: norm(input?.partyId),
    mealPreference: norm(input?.mealPreference),
    child: norm(input?.child).toUpperCase() === "Y" ? "Y" : "N",
    childAge: norm(input?.childAge),
    table: norm(input?.table),
  };
}

async function writeSeatingRows(guests) {
  const sheets = await getSheetsClient();
  const values = guests.map((guest) => [
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

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const guests = Array.isArray(req.body?.guests) ? req.body.guests.map(normalizeGuest) : [];
    await writeSeatingRows(guests);

    return res.json({
      ok: true,
      savedCount: guests.length,
      savedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("SEATING SAVE ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
