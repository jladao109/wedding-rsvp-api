import {
  setCors,
  requireAdminKey,
  getSheetsClient,
  norm,
} from "./_comm-helpers.js";

const LAYOUT_TAB = "Seating Layout";

const DEFAULT_LAYOUT = [
  { elementId: "gift", x: 520, y: 150, width: "", height: "", radius: 23, seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "cake", x: 790, y: 150, width: "", height: "", radius: 23, seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "sweetheart", x: 680, y: 152, width: 96, height: 32, radius: "", seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "photo-booth", x: 1265, y: 135, width: 48, height: 48, radius: "", seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "dance-floor", x: 565, y: 270, width: 255, height: 210, radius: "", seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "dj", x: 635, y: 715, width: 105, height: 34, radius: "", seatOrbitRadius: "", extraJson: "{}" },
  { elementId: "bar", x: 1278, y: 540, width: 18, height: 138, radius: "", seatOrbitRadius: "", extraJson: "{}" },

  { elementId: "table-1", x: 245, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-2", x: 450, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-3", x: 600, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },

  { elementId: "table-4", x: 245, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-5", x: 450, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-6", x: 600, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },

  { elementId: "table-7", x: 235, y: 665, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-8", x: 445, y: 665, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },

  { elementId: "table-9", x: 845, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-10", x: 1000, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-11", x: 1155, y: 190, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },

  { elementId: "table-12", x: 845, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-13", x: 1000, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-14", x: 1155, y: 405, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },

  { elementId: "table-15", x: 845, y: 650, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-16", x: 1000, y: 650, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-17", x: 1155, y: 650, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
  { elementId: "table-18", x: 1275, y: 720, width: "", height: "", radius: 50, seatOrbitRadius: 74, extraJson: "{}" },
];

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
      values: [headers],
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

    await ensureTabExistsWithHeaders(
      sheets,
      spreadsheetId,
      LAYOUT_TAB,
      ["Element ID", "X", "Y", "Width", "Height", "Radius", "Seat Orbit Radius", "Extra JSON"]
    );

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${LAYOUT_TAB}!A2:H`,
    });

    const rows = response.data.values || [];

    if (!rows.length) {
      const values = DEFAULT_LAYOUT.map((item) => [
        item.elementId,
        item.x,
        item.y,
        item.width,
        item.height,
        item.radius,
        item.seatOrbitRadius,
        item.extraJson,
      ]);

      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${LAYOUT_TAB}!A2:H`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values },
      });

      return res.json({ ok: true, layout: DEFAULT_LAYOUT });
    }

    const layout = rows.map((r) => ({
      elementId: norm(r[0]),
      x: Number(r[1] || 0),
      y: Number(r[2] || 0),
      width: r[3] === "" ? "" : Number(r[3]),
      height: r[4] === "" ? "" : Number(r[4]),
      radius: r[5] === "" ? "" : Number(r[5]),
      seatOrbitRadius: r[6] === "" ? "" : Number(r[6]),
      extraJson: norm(r[7] || "{}"),
    }));

    return res.json({ ok: true, layout });
  } catch (err) {
    console.error("SEATING LAYOUT LOAD ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
