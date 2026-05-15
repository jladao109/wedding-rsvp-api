import twilio from "twilio";

import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getSmsRecipients,
  appendCommLog,
  filterAudience,
  isValidPhone,
  normalizePhone,
  normLower,
} from "./_comm-helpers.js";

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid) throw new Error("Missing TWILIO_ACCOUNT_SID env var");
  if (!token) throw new Error("Missing TWILIO_AUTH_TOKEN env var");

  return twilio(sid, token);
}

function requireSmsConfig() {
  if (!process.env.TWILIO_MESSAGING_SERVICE_SID) {
    throw new Error("Missing TWILIO_MESSAGING_SERVICE_SID env var");
  }
}

function validateSmsBody(message) {
  const body = String(message || "").trim();

  if (!body) {
    throw new Error("SMS message is required.");
  }

  if (!body.toLowerCase().includes("stop")) {
    throw new Error("SMS message must include STOP opt-out language.");
  }

  if (!body.toLowerCase().includes("help")) {
    throw new Error("SMS message must include HELP language.");
  }

  return body;
}

async function sendOneSms({ to, body }) {
  requireSmsConfig();

  const client = getTwilioClient();

  return client.messages.create({
    to,
    body,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  });
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

function getSmsFilteredOutReasons(rows, payload) {
  const audienceRows = filterAudience(rows, payload || {});
  const audienceRowKeys = new Set(
    audienceRows.map((r) => `${r.rowNumber}|${normLower(r.partyId)}`)
  );

  const seenPhones = new Set();
  const filteredOut = [];

  rows.forEach((row) => {
    const rowKey = `${row.rowNumber}|${normLower(row.partyId)}`;

    if (!audienceRowKeys.has(rowKey)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone: row.phone || "",
        reason: "Did not match selected include audiences or manual includes, or matched an exclude rule.",
      });
      return;
    }

    if (row.rsvp !== "Y") {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone: row.phone || "",
        reason: `RSVP is "${row.rsvp || "blank"}" instead of "Y".`,
      });
      return;
    }

    if (!isValidPhone(row.phone)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone: row.phone || "",
        reason: "Missing or invalid phone number.",
      });
      return;
    }

    const phone = normalizePhone(row.phone);

    if (seenPhones.has(phone)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone,
        reason: "Duplicate phone number already included earlier in the preview.",
      });
      return;
    }

    seenPhones.add(phone);
  });

  return filteredOut;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const action = String(req.body?.action || "").trim();
    const message = String(req.body?.message || "").trim();

    if (action === "preview") {
      const rows = await readGuestRows();
      const recipients = getSmsRecipients(rows, req.body || {});
      const filteredOut = getSmsFilteredOutReasons(rows, req.body || {});
    
      return res.json({
        ok: true,
        count: recipients.length,
        recipients,
        filteredOut,
      });
    }

    if (action === "sendTest") {
      const body = validateSmsBody(message);
      const testPhone = String(req.body?.testPhone || "").trim();

      if (!testPhone) {
        return res.status(400).json({ error: "Test phone is required." });
      }

      const result = await sendOneSms({
        to: testPhone,
        body: `[TEST] ${body}`,
      });

      await appendCommLog({
        channel: "SMS",
        audience: { testMode: true, testPhone },
        subject: "Test SMS",
        count: 1,
        status: "TEST SENT",
        notes: testPhone,
      });

      return res.json({
        ok: true,
        mode: "test",
        sent: 1,
        sid: result.sid,
        phone: testPhone,
      });
    }

    if (action === "sendNow") {
      const body = validateSmsBody(message);

      const rows = await readGuestRows();
      const recipients = getSmsRecipients(rows, req.body || {});

      if (!recipients.length) {
        return res.status(400).json({ error: "No eligible SMS recipients found." });
      }

      const settled = await sendInChunks(
        recipients,
        5,
        recipient => sendOneSms({
          to: recipient.phone,
          body,
        })
      );

      const results = settled.map((r, i) => ({
        phone: recipients[i].phone,
        partyId: recipients[i].partyId,
        status: r.status,
        sid: r.status === "fulfilled" ? r.value.sid : null,
        error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null,
      }));

      const sent = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected");

      await appendCommLog({
        channel: "SMS",
        audience: {
          includeAudiences: req.body?.includeAudiences || [],
          excludeAudiences: req.body?.excludeAudiences || [],
          includePartyIds: req.body?.includePartyIds || [],
          includeRowNumbers: req.body?.includeRowNumbers || [],
          excludePartyIds: req.body?.excludePartyIds || [],
          excludeRowNumbers: req.body?.excludeRowNumbers || [],
        },
        subject: "SMS Send",
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
    }

    return res.status(400).json({ error: "Invalid SMS action." });
  } catch (err) {
    console.error("COMM SMS ERROR:", err);

    await appendCommLog({
      channel: "SMS",
      audience: req.body || {},
      subject: "SMS",
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
