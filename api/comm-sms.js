import twilio from "twilio";

import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getSmsRecipients,
  appendCommLog,
  appendCommHistory,
  updateLastContacted,
  filterAudience,
  getNormalizedPhoneList,
  isPhoneOptedOutForRow,
  isWholeRowSmsOptedOut,
  normLower,
  getSheetsClient,
  SCHEDULED_COMM_TAB,
  COMM_HISTORY_TAB,
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

    const phones = getNormalizedPhoneList(row.phone);

    if (!phones.length) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone: row.phone || "",
        reason: "Missing or invalid phone number.",
      });
      return;
    }
    
    if (isWholeRowSmsOptedOut(row.smsOptOutRaw)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        phone: row.phone || "",
        reason: "Entire row is opted out of SMS in Column S.",
      });
      return;
    }
    
    phones.forEach((phone) => {
      if (isPhoneOptedOutForRow(row, phone)) {
        filteredOut.push({
          rowNumber: row.rowNumber,
          partyId: row.partyId,
          phone,
          reason: "This phone number is opted out in Column S.",
        });
        return;
      }
    
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
  });

  return filteredOut;
}

function makeScheduleId() {
  return `SMS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function parseScheduledRow(row, index) {
  return {
    sheetRowNumber: index + 2,
    id: row[0] || "",
    type: row[1] || "",
    status: row[2] || "",
    sendAt: row[3] || "",
    subject: row[4] || "",
    message: row[5] || "",
    audienceJSON: row[6] || "",
    createdAt: row[7] || "",
    sentAt: row[8] || "",
    notes: row[9] || "",
  };
}

async function readScheduledRows() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SCHEDULED_COMM_TAB}!A2:J`,
  });

  return (response.data.values || []).map(parseScheduledRow);
}

async function updateScheduledStatus({ scheduled, status, sentAt = "", notes = "" }) {
  const sheets = await getSheetsClient();

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${SCHEDULED_COMM_TAB}!C${scheduled.sheetRowNumber}:J${scheduled.sheetRowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        status,
        scheduled.sendAt,
        scheduled.subject,
        scheduled.message,
        scheduled.audienceJSON,
        scheduled.createdAt,
        sentAt || scheduled.sentAt || "",
        notes || scheduled.notes || "",
      ]],
    },
  });
}

function parseCommHistoryRow(row, index) {
  return {
    sheetRowNumber: index + 2,
    timestamp: row[0] || "",
    channel: row[1] || "",
    direction: row[2] || "",
    partyId: row[3] || "",
    rowNumber: row[4] || "",
    recipient: row[5] || "",
    messageSid: row[6] || "",
    subject: row[7] || "",
    message: row[8] || "",
    status: row[9] || "",
    eventType: row[10] || "",
    scheduledId: row[11] || "",
    notes: row[12] || "",
    statusUpdatedAt: row[13] || "",
    errorCode: row[14] || "",
    errorMessage: row[15] || "",
    retryOf: row[16] || "",
  };
}

async function readCommHistoryRows() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${COMM_HISTORY_TAB}!A2:Q`,
  });

  return (response.data.values || []).map(parseCommHistoryRow);
}

function makeRetryDedupeKey(item) {
  return [
    String(item.channel).toUpperCase(),
    String(item.direction).toUpperCase(),
    String(item.recipient || "").trim(),
    String(item.message || "").trim(),
  ].join("|");
}

function getRetryReference(historyItem) {
  return historyItem.messageSid || `HistoryRow:${historyItem.sheetRowNumber}`;
}

async function recordSmsResult({
  recipient,
  body,
  result,
  status,
  error = "",
  subject = "SMS",
  eventType = "SMS_SEND",
  scheduledId = "",
  retryOf = "",
}) {
  const timestamp = new Date().toISOString();

  await appendCommHistory({
    channel: "SMS",
    direction: "OUTBOUND",
    partyId: recipient?.partyId || "",
    rowNumber: recipient?.rowNumber || "",
    recipient: recipient?.phone || "",
    messageSid: result?.sid || "",
    subject,
    message: body || "",
    status,
    eventType,
    scheduledId,
    notes: error || "",
    retryOf,
  });

  if (status === "SENT" && recipient?.rowNumber) {
    await updateLastContacted({
      rowNumber: recipient?.rowNumber,
      channel: "SMS",
      timestamp,
    });
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const action = String(req.body?.action || req.query?.action || "").trim();
  const isCronRun = action === "runScheduled";

  if (req.method !== "POST" && !(isCronRun && req.method === "GET")) {
    return res.status(405).json({ error: "Use POST" });
  }

  if (isCronRun) {
    const authHeader = req.headers.authorization || "";
    const expected = process.env.CRON_SECRET;

    if (!expected || authHeader !== `Bearer ${expected}`) {
      return res.status(401).json({ error: "Unauthorized cron request" });
    }
  } else {
    if (!requireAdminKey(req, res)) return;
  }

  try {
    // action is already defined above so cron can pass it by query string
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

    if (action === "schedule") {
      const body = validateSmsBody(message);
      const sendAt = String(req.body?.sendAt || "").trim();
    
      if (!sendAt) {
        return res.status(400).json({ error: "Scheduled send time is required." });
      }
    
      const sendAtDate = new Date(sendAt);
      if (Number.isNaN(sendAtDate.getTime())) {
        return res.status(400).json({ error: "Scheduled send time is invalid." });
      }
    
      if (sendAtDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Scheduled send time must be in the future." });
      }
    
      const rows = await readGuestRows();
      const recipients = getSmsRecipients(rows, req.body || {});
    
      if (!recipients.length) {
        return res.status(400).json({ error: "No eligible SMS recipients found for this schedule." });
      }
    
      const id = makeScheduleId();
      const createdAt = new Date().toISOString();
    
      const audience = {
        includeAudiences: req.body?.includeAudiences || [],
        excludeAudiences: req.body?.excludeAudiences || [],
        includePartyIds: req.body?.includePartyIds || [],
        includeRowNumbers: req.body?.includeRowNumbers || [],
        excludePartyIds: req.body?.excludePartyIds || [],
        excludeRowNumbers: req.body?.excludeRowNumbers || [],
        includeSmsPhones: req.body?.includeSmsPhones || [],
        excludeSmsPhones: req.body?.excludeSmsPhones || [],
      };
    
      const sheets = await getSheetsClient();
    
      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${SCHEDULED_COMM_TAB}!A:J`,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: {
          values: [[
            id,
            "SMS",
            "PENDING",
            sendAtDate.toISOString(),
            "SMS Send",
            body,
            JSON.stringify(audience),
            createdAt,
            "",
            `Scheduled for ${recipients.length} recipient(s).`,
          ]],
        },
      });
    
      await appendCommLog({
        channel: "SMS",
        audience,
        subject: "Scheduled SMS",
        count: recipients.length,
        status: "SCHEDULED",
        notes: id,
      });
    
      return res.json({
        ok: true,
        id,
        status: "PENDING",
        sendAt: sendAtDate.toISOString(),
        count: recipients.length,
      });
    }
    
    if (action === "listScheduled") {
      const scheduled = await readScheduledRows();
    
      return res.json({
        ok: true,
        scheduled: scheduled
          .filter((item) => item.id && item.type === "SMS")
          .reverse(),
      });
    }
    
    if (action === "cancelScheduled") {
      const id = String(req.body?.id || "").trim();
    
      if (!id) {
        return res.status(400).json({ error: "Scheduled message ID is required." });
      }
    
      const scheduledRows = await readScheduledRows();
      const scheduled = scheduledRows.find((item) => item.id === id);
    
      if (!scheduled) {
        return res.status(404).json({ error: "Scheduled message not found." });
      }
    
      if (scheduled.status !== "PENDING") {
        return res.status(400).json({ error: `Only PENDING messages can be cancelled. Current status: ${scheduled.status}` });
      }
    
      await updateScheduledStatus({
        scheduled,
        status: "CANCELLED",
        sentAt: "",
        notes: "Cancelled manually.",
      });
    
      await appendCommLog({
        channel: "SMS",
        audience: scheduled.audienceJSON,
        subject: "Scheduled SMS",
        count: 0,
        status: "CANCELLED",
        notes: id,
      });
    
      return res.json({
        ok: true,
        id,
        status: "CANCELLED",
      });
    }
    
    if (action === "runScheduled") {
      const scheduledRows = await readScheduledRows();
      const now = Date.now();
    
      const due = scheduledRows.filter((item) => {
        if (item.type !== "SMS") return false;
        if (item.status !== "PENDING") return false;
    
        const sendTime = new Date(item.sendAt).getTime();
        return Number.isFinite(sendTime) && sendTime <= now;
      });
    
      const results = [];
    
      for (const scheduled of due) {
        try {
          await updateScheduledStatus({
            scheduled,
            status: "PROCESSING",
            sentAt: "",
            notes: "Processing scheduled SMS.",
          });
    
          const audience = JSON.parse(scheduled.audienceJSON || "{}");
          const rows = await readGuestRows();
          const recipients = getSmsRecipients(rows, audience);
    
          if (!recipients.length) {
            await updateScheduledStatus({
              scheduled,
              status: "FAILED",
              sentAt: new Date().toISOString(),
              notes: "No eligible SMS recipients found at send time.",
            });
    
            results.push({
              id: scheduled.id,
              status: "FAILED",
              sent: 0,
              failed: 0,
              notes: "No eligible recipients.",
            });
    
            continue;
          }
    
          const body = validateSmsBody(scheduled.message);
    
          const settled = await sendInChunks(
            recipients,
            5,
            recipient => sendOneSms({
              to: recipient.phone,
              body,
            })
          );

          for (let i = 0; i < settled.length; i++) {
            const r = settled[i];
            const recipient = recipients[i];
          
            await recordSmsResult({
              recipient,
              body,
              result: r.status === "fulfilled" ? r.value : null,
              status: r.status === "fulfilled" ? "SENT" : "FAILED",
              error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : "",
              subject: "Scheduled SMS",
              eventType: "SMS_SCHEDULED_SEND",
              scheduledId: scheduled.id,
            });
          }
    
          const sent = settled.filter(r => r.status === "fulfilled").length;
          const failed = settled.filter(r => r.status === "rejected").length;
    
          await updateScheduledStatus({
            scheduled,
            status: failed ? "PARTIAL" : "SENT",
            sentAt: new Date().toISOString(),
            notes: `Sent: ${sent}. Failed: ${failed}.`,
          });
    
          await appendCommLog({
            channel: "SMS",
            audience,
            subject: "Scheduled SMS",
            count: sent,
            status: failed ? "PARTIAL" : "SENT",
            notes: scheduled.id,
          });
    
          results.push({
            id: scheduled.id,
            status: failed ? "PARTIAL" : "SENT",
            sent,
            failed,
          });
        } catch (err) {
          await updateScheduledStatus({
            scheduled,
            status: "FAILED",
            sentAt: new Date().toISOString(),
            notes: err?.message || String(err),
          });
    
          results.push({
            id: scheduled.id,
            status: "FAILED",
            sent: 0,
            failed: 0,
            error: err?.message || String(err),
          });
        }
      }
    
      return res.json({
        ok: true,
        checked: scheduledRows.length,
        due: due.length,
        results,
      });
    }

    if (action === "retryFailedSms") {
      const historyRows = await readCommHistoryRows();
    
      const successfulSmsKeys = new Set(
        historyRows
          .filter((item) => {
            const status = String(item.status).toUpperCase();
      
            return (
              String(item.channel).toUpperCase() === "SMS" &&
              String(item.direction).toUpperCase() === "OUTBOUND" &&
              ["SENT", "DELIVERED"].includes(status) &&
              item.recipient &&
              item.message
            );
          })
          .map(makeRetryDedupeKey)
      );
      
      const failedRows = historyRows.filter((item) => {
        if (String(item.channel).toUpperCase() !== "SMS") return false;
        if (String(item.direction).toUpperCase() !== "OUTBOUND") return false;
        if (String(item.status).toUpperCase() !== "FAILED") return false;
        if (!item.recipient) return false;
        if (!item.message) return false;
      
        if (successfulSmsKeys.has(makeRetryDedupeKey(item))) {
          return false;
        }
      
        return true;
      });
    
      if (!failedRows.length) {
        return res.json({
          ok: true,
          retried: 0,
          sent: 0,
          failed: 0,
          message: "No failed SMS rows found to retry.",
        });
      }
    
      const settled = await sendInChunks(
        failedRows,
        5,
        (item) => {
          const body = validateSmsBody(item.message);
    
          return sendOneSms({
            to: item.recipient,
            body,
          });
        }
      );
    
      const results = [];
    
      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        const item = failedRows[i];
    
        const recipient = {
          partyId: item.partyId,
          rowNumber: item.rowNumber,
          phone: item.recipient,
        };
    
        const error =
          r.status === "rejected"
            ? (r.reason?.message || String(r.reason))
            : "";
    
        await recordSmsResult({
          recipient,
          body: item.message,
          result: r.status === "fulfilled" ? r.value : null,
          status: r.status === "fulfilled" ? "SENT" : "FAILED",
          error,
          subject: item.subject || "SMS Retry",
          eventType: "SMS_RETRY",
          scheduledId: item.scheduledId || "",
          retryOf: getRetryReference(item),
        });
    
        results.push({
          originalHistoryRow: item.sheetRowNumber,
          retryOf: getRetryReference(item),
          phone: item.recipient,
          partyId: item.partyId,
          rowNumber: item.rowNumber,
          status: r.status === "fulfilled" ? "SENT" : "FAILED",
          sid: r.status === "fulfilled" ? r.value.sid : null,
          error,
        });
      }
    
      const sent = results.filter(r => r.status === "SENT").length;
      const failed = results.filter(r => r.status === "FAILED").length;
    
      await appendCommLog({
        channel: "SMS",
        audience: { retryFailedSms: true },
        subject: "Retry Failed SMS",
        count: sent,
        status: failed ? "PARTIAL" : "SENT",
        notes: failed ? `${failed} failed` : `${sent} retried successfully`,
      });
    
      return res.json({
        ok: true,
        retried: failedRows.length,
        sent,
        failed,
        results,
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

      await appendCommHistory({
        channel: "SMS",
        direction: "OUTBOUND",
        partyId: "",
        rowNumber: "",
        recipient: testPhone,
        messageSid: result.sid,
        subject: "Test SMS",
        message: `[TEST] ${body}`,
        status: "TEST SENT",
        eventType: "SMS_TEST",
        scheduledId: "",
        notes: "",
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

      const results = [];

      for (let i = 0; i < settled.length; i++) {
        const r = settled[i];
        const recipient = recipients[i];
      
        const item = {
          phone: recipient.phone,
          partyId: recipient.partyId,
          rowNumber: recipient.rowNumber,
          status: r.status,
          sid: r.status === "fulfilled" ? r.value.sid : null,
          error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null,
        };
      
        results.push(item);
      
        await recordSmsResult({
          recipient,
          body,
          result: r.status === "fulfilled" ? r.value : null,
          status: r.status === "fulfilled" ? "SENT" : "FAILED",
          error: item.error || "",
          subject: "SMS Send",
          eventType: "SMS_SEND",
        });
      }

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
          includeSmsPhones: req.body?.includeSmsPhones || [],
          excludeSmsPhones: req.body?.excludeSmsPhones || [],
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
