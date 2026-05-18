import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getEmailRecipients,
  appendCommLog,
  appendCommHistory,
  updateLastContacted,
  buildTextFromHtml,
  isValidEmail,
  getSheetsClient,
  SCHEDULED_COMM_TAB,
} from "./_comm-helpers.js";

async function sendOneEmail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_INFO || "info@bigornia2ladao.com";

  if (!key) throw new Error("Missing RESEND_API_KEY env var");

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
      bcc: ["jason.ladao@gmail.com", "yvbornia@gmail.com"],
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

    if (i + chunkSize < items.length) await sleep(1200);
  }

  return results;
}

function makeScheduleId() {
  return `EMAIL-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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

async function recordEmailResult({
  recipient,
  subject,
  html,
  result,
  status,
  error = "",
  eventType = "EMAIL_SEND",
  scheduledId = "",
}) {
  const timestamp = new Date().toISOString();

  await appendCommHistory({
    channel: "EMAIL",
    direction: "OUTBOUND",
    partyId: recipient?.partyId || "",
    rowNumber: recipient?.rowNumber || "",
    recipient: recipient?.email || "",
    messageSid: result?.id || "",
    subject,
    message: html || "",
    status,
    eventType,
    scheduledId,
    notes: error || "",
  });

  if (status === "SENT" && recipient?.rowNumber) {
    await updateLastContacted({
      rowNumber: recipient.rowNumber,
      channel: "EMAIL",
      timestamp,
    });
  }
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();

  const action = String(req.body?.action || req.query?.action || "").trim();
  const isCronRun = action === "runScheduledEmail";

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

  const subject = String(req.body?.subject || "").trim();
  const html = String(req.body?.html || "").trim();
  const testMode = !!req.body?.testMode;
  const testEmail = String(req.body?.testEmail || "").trim();

  try {
    if (action === "listScheduledEmail") {
      const scheduled = await readScheduledRows();

      return res.json({
        ok: true,
        scheduled: scheduled
          .filter((item) => item.id && item.type === "EMAIL")
          .reverse(),
      });
    }

    if (action === "cancelScheduledEmail") {
      const id = String(req.body?.id || "").trim();

      if (!id) {
        return res.status(400).json({ error: "Scheduled email ID is required." });
      }

      const scheduledRows = await readScheduledRows();
      const scheduled = scheduledRows.find((item) => item.id === id && item.type === "EMAIL");

      if (!scheduled) {
        return res.status(404).json({ error: "Scheduled email not found." });
      }

      if (scheduled.status !== "PENDING") {
        return res.status(400).json({ error: `Only PENDING emails can be cancelled. Current status: ${scheduled.status}` });
      }

      await updateScheduledStatus({
        scheduled,
        status: "CANCELLED",
        sentAt: "",
        notes: "Cancelled manually.",
      });

      await appendCommLog({
        channel: "EMAIL",
        audience: scheduled.audienceJSON,
        subject: scheduled.subject,
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

    if (action === "runScheduledEmail") {
      const scheduledRows = await readScheduledRows();
      const now = Date.now();

      const due = scheduledRows.filter((item) => {
        if (item.type !== "EMAIL") return false;
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
            notes: "Processing scheduled email.",
          });

          const audience = JSON.parse(scheduled.audienceJSON || "{}");
          const rows = await readGuestRows();
          const recipients = getEmailRecipients(rows, audience);

          if (!recipients.length) {
            await updateScheduledStatus({
              scheduled,
              status: "FAILED",
              sentAt: new Date().toISOString(),
              notes: "No eligible email recipients found at send time.",
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

          const text = buildTextFromHtml(scheduled.message);

          const settled = await sendInChunks(
            recipients,
            5,
            (recipient) => sendOneEmail({
              to: recipient.email,
              subject: scheduled.subject,
              html: scheduled.message,
              text,
            })
          );

          for (let i = 0; i < settled.length; i++) {
            const r = settled[i];
            const recipient = recipients[i];

            await recordEmailResult({
              recipient,
              subject: scheduled.subject,
              html: scheduled.message,
              result: r.status === "fulfilled" ? r.value : null,
              status: r.status === "fulfilled" ? "SENT" : "FAILED",
              error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : "",
              eventType: "EMAIL_SCHEDULED_SEND",
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
            channel: "EMAIL",
            audience,
            subject: scheduled.subject,
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

    if (!subject) return res.status(400).json({ error: "Subject is required." });
    if (!html) return res.status(400).json({ error: "HTML is required." });

    const text = buildTextFromHtml(html);

    if (action === "scheduleEmail") {
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
      const recipients = getEmailRecipients(rows, req.body || {});

      if (!recipients.length) {
        return res.status(400).json({ error: "No eligible email recipients found for this schedule." });
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
            "EMAIL",
            "PENDING",
            sendAtDate.toISOString(),
            subject,
            html,
            JSON.stringify(audience),
            createdAt,
            "",
            `Scheduled for ${recipients.length} recipient(s).`,
          ]],
        },
      });

      await appendCommLog({
        channel: "EMAIL",
        audience,
        subject,
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

    if (testMode) {
      if (!testEmail) return res.status(400).json({ error: "Test email is required for test mode." });
      if (!isValidEmail(testEmail)) return res.status(400).json({ error: "Please provide a valid test email." });

      const sendResult = await sendOneEmail({
        to: testEmail,
        subject: `[TEST] ${subject}`,
        html,
        text,
      });

      await appendCommHistory({
        channel: "EMAIL",
        direction: "OUTBOUND",
        partyId: "",
        rowNumber: "",
        recipient: testEmail,
        messageSid: sendResult?.id || "",
        subject: `[TEST] ${subject}`,
        message: html,
        status: "TEST SENT",
        eventType: "EMAIL_TEST",
        scheduledId: "",
        notes: "",
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

    const results = [];

    for (let i = 0; i < settled.length; i++) {
      const r = settled[i];
      const recipient = recipients[i];

      const item = {
        email: recipient.email,
        partyId: recipient.partyId,
        rowNumber: recipient.rowNumber,
        status: r.status,
        id: r.status === "fulfilled" ? r.value?.id : null,
        error: r.status === "rejected" ? (r.reason?.message || String(r.reason)) : null,
      };

      results.push(item);

      await recordEmailResult({
        recipient,
        subject,
        html,
        result: r.status === "fulfilled" ? r.value : null,
        status: r.status === "fulfilled" ? "SENT" : "FAILED",
        error: item.error || "",
        eventType: "EMAIL_SEND",
      });
    }

    const sent = results.filter(r => r.status === "fulfilled").length;
    const failed = results.filter(r => r.status === "rejected");

    await appendCommLog({
      channel: "EMAIL",
      audience: {
        includeAudiences: req.body?.includeAudiences || [],
        excludeAudiences: req.body?.excludeAudiences || [],
        includePartyIds: req.body?.includePartyIds || [],
        includeRowNumbers: req.body?.includeRowNumbers || [],
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
