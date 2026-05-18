import {
  getSheetsClient,
  COMM_HISTORY_TAB,
  norm,
} from "./_comm-helpers.js";

function parseBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  const raw = typeof req.body === "string" ? req.body : "";

  return Object.fromEntries(
    new URLSearchParams(raw)
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Use POST");
  }

  try {
    const data = parseBody(req);

    console.log(
      "TWILIO STATUS CALLBACK:",
      JSON.stringify(data, null, 2)
    );

    const messageSid = norm(data.MessageSid);
    const messageStatus = norm(data.MessageStatus);
    const errorCode = norm(data.ErrorCode);
    const errorMessage = norm(data.ErrorMessage);

    if (!messageSid) {
      return res.status(200).send("Missing MessageSid");
    }

    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${COMM_HISTORY_TAB}!A2:P`,
    });

    const rows = response.data.values || [];

    let matchedRowNumber = null;

    rows.forEach((row, idx) => {
      const rowMessageSid = norm(row[6]); // G = MessageSID

      if (rowMessageSid === messageSid) {
        matchedRowNumber = idx + 2;
      }
    });

    if (!matchedRowNumber) {
      console.log("No matching Message SID found:", messageSid);

      return res.status(200).send("No matching SID");
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${COMM_HISTORY_TAB}!J${matchedRowNumber}:P${matchedRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          messageStatus.toUpperCase(),
          rows[matchedRowNumber - 2]?.[10] || "",
          rows[matchedRowNumber - 2]?.[11] || "",
          rows[matchedRowNumber - 2]?.[12] || "",
          new Date().toISOString(),
          errorCode,
          errorMessage,
        ]],
      },
    });

    return res.status(200).send("OK");
  } catch (err) {
    console.error("TWILIO STATUS ERROR:", err);

    return res.status(500).send("Server error");
  }
}
