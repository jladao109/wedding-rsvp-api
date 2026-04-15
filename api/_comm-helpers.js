import { google } from "googleapis";

export const TAB_NAME = "Guests";
export const COMM_LOG_TAB = process.env.COMM_LOG_TAB || "Comm Log";

export function norm(s) {
  return String(s ?? "").trim();
}

export function normLower(s) {
  return norm(s).toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm(email));
}

function isChecked(value) {
  const v = normLower(value);
  return v === "y" || v === "yes" || v === "true" || v === "checked" || v === "1";
}

export function setCors(req, res) {
  const origin = req.headers.origin;
  const allowed = new Set([
    "https://bigornia2ladao.com",
    "https://www.bigornia2ladao.com",
    "http://localhost:8888",
    "http://127.0.0.1:8888",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
  ]);

  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
}

export function requireAdminKey(req, res) {
  const provided = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_COMM_KEY;

  if (!expected) {
    res.status(500).json({ error: "Missing ADMIN_COMM_KEY env var" });
    return false;
  }

  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }

  return true;
}

export async function getSheetsClient() {
  if (!process.env.SPREADSHEET_ID) {
    throw new Error("Missing SPREADSHEET_ID env var");
  }
  if (!process.env.GOOGLE_CREDENTIALS) {
    throw new Error("Missing GOOGLE_CREDENTIALS env var");
  }

  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  return google.sheets({ version: "v4", auth });
}

export async function readGuestRows() {
  const sheets = await getSheetsClient();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${TAB_NAME}!A2:O`,
  });

  const rows = response.data.values || [];

  return rows.map((row, idx) => {
    const rowNumber = idx + 2;

    return {
      rowNumber,
      partyId: norm(row[0]),             // A
      names: norm(row[1]),               // B
      zips: norm(row[2]),                // C
      seatsReserved: norm(row[3]),       // D
      rsvp: norm(row[4]).toUpperCase(),  // E
      countComing: norm(row[5]),         // F
      comingNames: norm(row[6]),         // G
      meals: norm(row[7]),               // H
      ages: norm(row[8]),                // I
      email: norm(row[9]),               // J
      phone: norm(row[10]),              // K
      cutoffDate: norm(row[11]),         // L
      entourageGroup: norm(row[12]),     // M
      rehearsalDinnerRaw: norm(row[13]), // N
      rehearsalDinner: isChecked(row[13]),
      hotelGuestRaw: norm(row[14]),      // O
      hotelGuest: isChecked(row[14]),
    };
  });
}

function audienceMatch(row, audience) {
  const a = normLower(audience);
  const group = normLower(row.entourageGroup);
  const BOTH = "bridesmaid and groomsman";

  if (a === "all") return true;
  if (a === "guests") return !norm(row.entourageGroup);
  if (a === "entourage") return !!norm(row.entourageGroup);
  if (a === "parents") return group === "parents";
  if (a === "groomsmen") return group === "groomsmen" || group === BOTH;
  if (a === "bridesmaids") return group === "bridesmaids" || group === BOTH;
  if (a === "sponsors") return group === "sponsors";
  if (a === "rehearsal") return row.rehearsalDinner === true;
  if (a === "hotel") return row.hotelGuest === true;

  return false;
}

function normalizeAudienceList(input) {
  if (Array.isArray(input)) {
    return input.map(normLower).filter(Boolean);
  }
  if (typeof input === "string") {
    return norm(input)
      .split(",")
      .map(normLower)
      .filter(Boolean);
  }
  return [];
}

export function filterAudience(rows, audience) {
  const includeList = normalizeAudienceList(
    audience?.includeAudiences ?? audience?.include ?? audience
  );
  const excludeList = normalizeAudienceList(
    audience?.excludeAudiences ?? audience?.exclude ?? []
  );

  const includes = includeList.length ? includeList : ["all"];

  return rows.filter((row) => {
    const included = includes.some((a) => audienceMatch(row, a));
    if (!included) return false;

    const excluded = excludeList.some((a) => audienceMatch(row, a));
    if (excluded) return false;

    return true;
  });
}

export function getEmailRecipients(rows, audience) {
  const filtered = filterAudience(rows, audience)
    .filter(r => r.rsvp === "Y")
    .filter(r => isValidEmail(r.email));

  const seen = new Set();
  const deduped = [];

  for (const row of filtered) {
    const key = normLower(row.email);
    if (seen.has(key)) continue;
    seen.add(key);

    deduped.push({
      rowNumber: row.rowNumber,
      partyId: row.partyId,
      email: row.email,
      entourageGroup: row.entourageGroup,
      rehearsalDinner: row.rehearsalDinner === true,
      hotelGuest: row.hotelGuest === true,
      countComing: row.countComing,
      cutoffDate: row.cutoffDate,
    });
  }

  return deduped;
}

export async function appendCommLog({
  channel,
  audience,
  subject = "",
  count = 0,
  status = "SENT",
  notes = "",
}) {
  try {
    const sheets = await getSheetsClient();

    const audienceText =
      typeof audience === "string"
        ? audience
        : JSON.stringify(audience);

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SPREADSHEET_ID,
      range: `${COMM_LOG_TAB}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[
          new Date().toISOString(),
          channel,
          audienceText,
          subject,
          count,
          `${status}${notes ? ` — ${notes}` : ""}`
        ]],
      },
    });
  } catch (err) {
    console.error("COMM LOG ERROR:", err);
  }
}

export function buildTextFromHtml(html) {
  return norm(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function buildStarterEmailHtml() {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
            <tr>
              <td>
                <img
                  src="https://bigornia2ladao.com/images/emailComms-top.png"
                  alt=""
                  width="600"
                  style="display:block;width:100%;height:auto;border:0;"
                >
              </td>
            </tr>

            <tr>
              <td style="padding:36px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#111111;text-align:center;">
                <!-- TYPE YOUR HEADLINE IN THE LINE BELOW -->  
                    <p style="margin:0 0 18px;font-size:18px;"><strong>Your headline goes here</strong></p>
                <!-- REPLACE BELOW LINE WITH YOUR HTML EMAIL CONTENT -->
                    <p style="margin:0 0 18px;">Your body copy goes here.</p>
                <!-- END HTML EMAIL CONTENT-->    
                <p style="margin:0;">
                  <a href="https://bigornia2ladao.com" style="color:#111111;">Visit our wedding website</a>
                </p>
              </td>
            </tr>

            <tr>
              <td>
                <img
                  src="https://bigornia2ladao.com/images/emailComms-bottom.png"
                  alt=""
                  width="600"
                  style="display:block;width:100%;height:auto;border:0;"
                >
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:0px 30px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000000;text-align:center;">
      <p>If this message landed in your Junk folder, please mark it as “Not Junk” so you don’t miss important wedding updates.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}
