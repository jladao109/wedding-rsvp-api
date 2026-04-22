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

    // 🔑 Core recipient matching
    const recipients = getEmailRecipients(rows, req.body || {});

    // Optional: still build text version (kept from your original)
    const text = buildTextFromHtml(html);

    // 🔍 DEBUG: detect duplicate emails BEFORE dedupe (if needed later)
    const emailCounts = {};
    rows.forEach(r => {
      const email = String(r.email || "").toLowerCase().trim();
      if (!email) return;
      emailCounts[email] = (emailCounts[email] || 0) + 1;
    });

    const duplicateEmails = Object.entries(emailCounts)
      .filter(([, count]) => count > 1)
      .map(([email, count]) => ({ email, count }));

    return res.json({
      ok: true,
      count: recipients.length,
      recipients,

      // 🔥 extra debug info (safe + very helpful)
      debug: {
        duplicateEmails,
        totalRows: rows.length,
      },
    });
  } catch (err) {
    console.error("COMM PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
