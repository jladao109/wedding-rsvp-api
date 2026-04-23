import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  norm,
} from "./_comm-helpers.js";

const LAYOUT_TAB = "Seating Layout";

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

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:H1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        "Element ID",
        "X",
        "Y",
        "Width",
        "Height",
        "Radius",
        "Seat Orbit Radius",
        "Extra JSON"
      ]],
    },
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

    await ensureTabExistsWithHeaders(sheets, spreadsheetId, LAYOUT_TAB, []);

    const layout = Array.isArray(req.body?.layout) ? req.body.layout : [];

    const values = layout.map((item) => [
      norm(item.elementId),
      item.x ?? "",
      item.y ?? "",
      item.width ?? "",
      item.height ?? "",
      item.radius ?? "",
      item.seatOrbitRadius ?? "",
      norm(item.extraJson || "{}"),
    ]);

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${LAYOUT_TAB}!A2:H`,
    });

    if (values.length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${LAYOUT_TAB}!A2:H`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("SEATING LAYOUT SAVE ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
