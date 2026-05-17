import {
  getSheetsClient,
  TAB_NAME,
  normalizePhone,
  getNormalizedPhoneList,
  isWholeRowSmsOptedOut,
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

function formatPhoneListForSheet(phoneSet) {
  return Array.from(phoneSet)
    .filter(Boolean)
    .map(phone => phone.replace(/^\+/, ""))
    .join("; ");
}

async function updateSmsOptOutByPhone({ fromPhone, shouldOptOut }) {
  const sheets = await getSheetsClient();
  const normalizedFrom = normalizePhone(fromPhone);

  if (!normalizedFrom) {
    return { matched: 0, updated: 0, reason: "Invalid sender phone." };
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${TAB_NAME}!A2:S`,
  });

  const rows = response.data.values || [];
  const updates = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;

    const phonesInRow = getNormalizedPhoneList(row[10]); // Column K
    if (!phonesInRow.includes(normalizedFrom)) return;

    const currentOptOutRaw = row[18] || ""; // Column S
    const optedOutPhones = new Set(getNormalizedPhoneList(currentOptOutRaw));

    if (isWholeRowSmsOptedOut(currentOptOutRaw)) {
      if (shouldOptOut) return;

      updates.push({
        range: `${TAB_NAME}!S${rowNumber}`,
        values: [[""]],
      });
      return;
    }

    if (shouldOptOut) {
      optedOutPhones.add(normalizedFrom);
    } else {
      optedOutPhones.delete(normalizedFrom);
    }

    updates.push({
      range: `${TAB_NAME}!S${rowNumber}`,
      values: [[formatPhoneListForSheet(optedOutPhones)]],
    });
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

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  } catch (err) {
    console.error("TWILIO INBOUND ERROR:", err);
    return res.status(500).send("Server error");
  }
}
