import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getEmailRecipients,
  appendCommLog,
  buildTextFromHtml,
  isValidEmail,
} from "./_comm-helpers.js";

async function sendOneEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_INFO || "info@bigornia2ladao.com";

  if (!key) {
    throw new Error("Missing RESEND_API_KEY env var");
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
      text,
      bcc: [
        "jason.ladao@gmail.com",
        "yvbornia@gmail.com"
      ],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(body || "Resend send failed");
  }

  return resp.json().catch(() => ({}));
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendInChunks(items, chunkSize, fn) {
  const results = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const settled = await Promise.allSettled(chunk.map(fn));
    results.push(...settled);

    if (i + chunkSize < items.length) {
      await sleep(1200);
    }
  }

  return results;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  const subject = String(req.body?.subject || "").trim();
  const html = String(req.body?.html || "").trim();
  const testMode = !!req.body?.testMode;
  const testEmail = String(req.body?.testEmail || "").trim();

  if (!subject) {
    return res.status(400).json({ error: "Subject is required." });
  }
  if (!html) {
    return res.status(400).json({ error: "HTML is required." });
  }

  try {
    const text = buildTextFromHtml(html);

    if (testMode) {
      if (!testEmail) {
        return res.status(400).json({ error: "Test email is required for test mode." });
      }

      if (!isValidEmail(testEmail)) {
        return res.status(400).json({ error: "Please provide a valid test email." });
      }

      const sendResult = await sendOneEmail({
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
        text,
      });

      await appendCommLog({
        channel: "EMAIL",
        audience: { testMode: true, testEmail },
        subject,
        count: 1,
        status: "TEST SENT",
        notes: testEmail,
      });

      return res.json({
        ok: true,
        mode: "test",
        sent: 1,
        email: testEmail,
        resendResult: sendResult,
      });
    }

    const rows = await readGuestRows();
    const recipients = getEmailRecipients(rows, req.body || {});

    if (!recipients.length) {
      return res.status(400).json({ error: "No eligible recipients found." });
    }

    const settled = await sendInChunks(
      recipients,
      5,
      (recipient) => sendOneEmail({
        to: recipient.email,
        subject,
        html,
        text,
      })
    );

    const results = settled.map((r, i) => ({
      email: recipients[i].email,
      partyId: recipients[i].partyId,
      status: r.status,
      error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null,
    }));

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected");

    await appendCommLog({
      channel: "EMAIL",
      audience: {
        includeAudiences: req.body?.includeAudiences || [],
        excludeAudiences: req.body?.excludeAudiences || [],
        excludePartyIds: req.body?.excludePartyIds || [],
        excludeRowNumbers: req.body?.excludeRowNumbers || [],
      },
      subject,
      count: sent,
      status: failed.length ? "PARTIAL" : "SENT",
      notes: failed.length ? `${failed.length} failed` : "",
    });

    return res.json({
      ok: true,
      count: recipients.length,
      sent,
      failed: failed.length,
      failures: failed,
    });
  } catch (err) {
    console.error("COMM SEND EMAIL ERROR:", err);

    await appendCommLog({
      channel: "EMAIL",
      audience: req.body || {},
      subject,
      count: 0,
      status: "FAILED",
      notes: err?.message || String(err),
    });

    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
