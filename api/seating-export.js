import {
  setCors,
  requireAdminKey,
  getSheetsClient,
} from "./_comm-helpers.js";

const TAB = process.env.SEATING_OUTPUT_TAB || "Tables Seats";

const TABLE_MAP = {
  9:{nameCol:"E",mealCol:"F",startRow:2,endRow:13},
  10:{nameCol:"H",mealCol:"I",startRow:2,endRow:13},
  11:{nameCol:"K",mealCol:"L",startRow:2,endRow:13},
  12:{nameCol:"N",mealCol:"O",startRow:2,endRow:13},
  13:{nameCol:"Q",mealCol:"R",startRow:2,endRow:13},

  14:{nameCol:"E",mealCol:"F",startRow:16,endRow:27},
  15:{nameCol:"H",mealCol:"I",startRow:16,endRow:27},
  16:{nameCol:"K",mealCol:"L",startRow:16,endRow:27},
  17:{nameCol:"N",mealCol:"O",startRow:16,endRow:27},
  18:{nameCol:"Q",mealCol:"R",startRow:16,endRow:27},

  1:{nameCol:"E",mealCol:"F",startRow:31,endRow:40},
  2:{nameCol:"H",mealCol:"I",startRow:31,endRow:40},
  3:{nameCol:"K",mealCol:"L",startRow:31,endRow:40},
  4:{nameCol:"N",mealCol:"O",startRow:31,endRow:40},

  5:{nameCol:"E",mealCol:"F",startRow:45,endRow:56},
  6:{nameCol:"H",mealCol:"I",startRow:45,endRow:56},
  7:{nameCol:"K",mealCol:"L",startRow:45,endRow:56},
  8:{nameCol:"N",mealCol:"O",startRow:45,endRow:56},
};

function mealAbbrev(value) {
  const meal = String(value || "").trim().toLowerCase();

  const map = {
    chicken: "C",
    fish: "F",
    beef: "B",
    vegetarian: "V",
    "chicken fingers": "CF",
    "grilled cheese": "GC",
  };

  return map[meal] || value || "";
}

function isChild(g) {
  return (
    String(g.child || "").toUpperCase() === "Y" ||
    String(g.guestType || "").toLowerCase() === "child"
  );
}

function displayName(g) {
  const name = String(g.name || "").trim();
  return isChild(g) ? `${name} (child)` : name;
}

function isBride(g) {
  return String(g.name || "").toLowerCase().includes("yvette");
}

function isGroom(g) {
  return String(g.name || "").toLowerCase().includes("jason");
}

function isPendingRsvp(g) {
  const status = String(
    g.rsvpStatus || g.status || g.response || g.rsvp || ""
  ).trim().toLowerCase();

  return status === "pending";
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  if (!requireAdminKey(req, res)) return;

  try {
    const spreadsheetId = process.env.SEATING_OUTPUT_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return res.status(500).json({ error: "Missing SEATING_OUTPUT_SPREADSHEET_ID" });
    }

    const guests = Array.isArray(req.body?.guests) ? req.body.guests : [];

    const sheets = await getSheetsClient();

    const clearRanges = [
      `${TAB}!A2:B3`,
      `${TAB_RANGE}!Q31:Q`,
      ...Object.values(TABLE_MAP).map(
        (m) => `${TAB}!${m.nameCol}${m.startRow}:${m.mealCol}${m.endRow}`
      ),
    ];

    await sheets.spreadsheets.values.batchClear({
      spreadsheetId,
      requestBody: { ranges: clearRanges },
    });

    const data = [];

    const bride = guests.find(isBride);
    const groom = guests.find(isGroom);

    data.push({
      range: `${TAB}!A2:B3`,
      values: [
        [bride ? displayName(bride) : "", bride ? mealAbbrev(bride.mealPreference || bride.meal) : ""],
        [groom ? displayName(groom) : "", groom ? mealAbbrev(groom.mealPreference || groom.meal) : ""],
      ],
    });

    // --- Pending RSVP section ---
    const pendingGuests = guests
      .filter(isPendingRsvp)
      .map((g) => [displayName(g)]);
    
    if (pendingGuests.length) {
      data.push({
        range: `${TAB_RANGE}!Q31:Q${30 + pendingGuests.length}`,
        values: pendingGuests,
      });
    }

    Object.entries(TABLE_MAP).forEach(([tableId, map]) => {
      const seatCount = map.endRow - map.startRow + 1;

      const seated = guests
        .filter((g) => String(g.table || "") === String(tableId))
        .sort((a, b) => Number(a.seatIndex || 0) - Number(b.seatIndex || 0));

      const values = Array.from({ length: seatCount }, (_, i) => {
        const guest = seated.find((g) => Number(g.seatIndex) === i);
        return guest
          ? [displayName(guest), mealAbbrev(guest.mealPreference || guest.meal)]
          : ["", ""];
      });

      data.push({
        range: `${TAB}!${map.nameCol}${map.startRow}:${map.mealCol}${map.endRow}`,
        values,
      });
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    });

    return res.json({
      ok: true,
      exportedGuests: guests.length,
      updatedRanges: data.length,
    });
  } catch (err) {
    console.error("SEATING EXPORT ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
