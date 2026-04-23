import { getSheetsClient } from "./_comm-helpers.js";

export default async function handler(req,res){

  const sheets = await getSheetsClient();

  const guestsRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:"Guests!A2:O"
  });

  const seatingRes = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range:"Seating!A2:F"
  });

  const rows = guestsRes.data.values || [];
  const seatingRows = seatingRes.data.values || [];

  const guests = rows.map(r=>({
    name:r[1],
    partyId:r[0],
    table:null
  }));

  seatingRows.forEach(r=>{
    const g = guests.find(x=>x.name===r[0]);
    if(g) g.table = r[5];
  });

  const tables = [];

  for(let i=1;i<=18;i++){
    tables.push({
      id:i,
      x:150 + (i%6)*200,
      y:150 + Math.floor(i/6)*200,
      size:10
    });
  }

  res.json({ guests, tables });
}
