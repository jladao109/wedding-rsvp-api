import { getSheetsClient } from "./_comm-helpers.js";

export default async function handler(req,res){

  const sheets = await getSheetsClient();

  const { guests } = req.body;

  const values = guests.map(g=>[
    g.name,
    g.partyId,
    "",
    "",
    "",
    g.table || ""
  ]);

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:"Seating!A2:F",
    valueInputOption:"USER_ENTERED",
    requestBody:{ values }
  });

  res.json({ ok:true });
}
