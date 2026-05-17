import { twiml } from "twilio";

import {
  getSheetsClient,
  TAB_NAME,
  normalizePhone,
  norm,
} from "./_comm-helpers.js";

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  const raw = typeof req.body === "string" ? req.body : "";
  return Object.fromEntries(new URLSearchParams(raw));
}

function isStop(body, optOutType) {
  const text = norm(body).toUpperCase();
  const type = norm(optOutType).toUpperCase();

  return type === "STOP" ||
    ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"].includes(text);
}

function isStart(body, optOutType) {
  const text = norm(body).toUpperCase();
  const type = norm(optOutType).toUpperCase();

  return type === "START" ||
    ["START", "YES", "UNSTOP"].includes(text);
}

async function updateSmsOptOutByPhone({ fromPhone, shouldOptOut }) {
  const sheets = await getSheetsClient();
  const normalizedFrom = normalizePhone(fromPhone);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${TAB_NAME}!A2:S`,
  });

  const rows = response.data.values || [];
  const updates = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const sheetPhone = normalizePhone(row[10]); // Column K

    if (sheetPhone && sheetPhone === normalizedFrom) {
      updates.push({
        range: `${TAB_NAME}!S${rowNumber}`,
        values: [[shouldOptOut ? "Y" : ""]],
      });
    }
  });

  if (!updates.length) {
    return { matched: 0, updated: 0 };
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: process.env.SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates,
    },
  });

  return { matched: updates.length, updated: updates.length };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Use POST");
  }

  try {
    const data = parseBody(req);

    console.log(
      "TWILIO INBOUND DATA:",
      JSON.stringify(data, null, 2)
    );

    const from = data.From || "";
    const body = data.Body || "";
    const optOutType = data.OptOutType || "";

    if (isStop(body, optOutType)) {
      await updateSmsOptOutByPhone({
        fromPhone: from,
        shouldOptOut: true,
      });
    }

    if (isStart(body, optOutType)) {
      await updateSmsOptOutByPhone({
        fromPhone: from,
        shouldOptOut: false,
      });
    }

    const response = new twiml.MessagingResponse();
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(response.toString());
  } catch (err) {
    console.error("TWILIO INBOUND ERROR:", err);
    return res.status(500).send("Server error");
  }
}
