import {
  setCors,
  requireAdminKey,
  getSheetsClient,
} from "./_comm-helpers.js";

const TAB = process.env.SEATING_OUTPUT_TAB || "Tables Seats";

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const spreadsheetId = process.env.SEATING_OUTPUT_SPREADSHEET_ID;

    if (!spreadsheetId) {
      return res.status(500).json({ error: "Missing SEATING_OUTPUT_SPREADSHEET_ID" });
    }

    const sheets = await getSheetsClient();

    const meta = await sheets.spreadsheets.get({ spreadsheetId });

    const sheet = meta.data.sheets?.find(
      (s) => s.properties?.title === TAB
    );

    if (!sheet) {
      return res.status(404).json({ error: `Tab not found: ${TAB}` });
    }

    const gid = sheet.properties.sheetId;

    const params = new URLSearchParams({
      format: "pdf",
      gid: String(gid),
      size: "7",              // Letter 8.5 x 11
      portrait: "false",      // Landscape
      fitw: "true",           // Fit to width
      sheetnames: "false",
      printtitle: "false",
      pagenumbers: "false",
      gridlines: "false",
      fzr: "false",
      top_margin: "0.25",
      bottom_margin: "0.25",
      left_margin: "0.25",
      right_margin: "0.25",
    });

    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?${params.toString()}`;

    return res.json({ ok: true, url });
  } catch (err) {
    console.error("SEATING PRINT SPREADSHEET ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
