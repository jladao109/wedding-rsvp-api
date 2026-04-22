import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getEmailRecipients,
  buildTextFromHtml,
} from "./_comm-helpers.js";

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  const subject = String(req.body?.subject || "").trim();
  const html = String(req.body?.html || "").trim();

  if (!subject) {
    return res.status(400).json({ error: "Subject is required." });
  }
  if (!html) {
    return res.status(400).json({ error: "HTML is required." });
  }

  try {
    const rows = await readGuestRows();
    const recipients = getEmailRecipients(rows, req.body || {});
    const text = buildTextFromHtml(html);

    return res.json({
      ok: true,
      count: recipients.length,
      recipients,
    });
  } catch (err) {
    console.error("COMM PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
