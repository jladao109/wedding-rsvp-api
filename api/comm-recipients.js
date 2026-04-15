import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getEmailRecipients,
} from "./_comm-helpers.js";

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const rows = await readGuestRows();
    const recipients = getEmailRecipients(rows, req.body || {});

    return res.json({
      ok: true,
      count: recipients.length,
      recipients,
    });
  } catch (err) {
    console.error("COMM RECIPIENTS ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
