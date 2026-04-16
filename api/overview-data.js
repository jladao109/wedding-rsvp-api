import {
  setCors,
  requireAdminKey,
  readGuestRows,
  norm,
  normLower,
} from "./_comm-helpers.js";

function parseDelimitedList(cell, delimiter = ";") {
  return norm(cell)
    .split(delimiter)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseNameTriplet(nameStr) {
  const parts = String(nameStr ?? "")
    .split(",")
    .map((p) => p.trim());

  const last = parts[0] ?? "";
  const first = parts[1] ?? "";
  const suffix = parts[2] ?? "";

  const display = [first, last, suffix].filter(Boolean).join(" ");
  const key = [normLower(last), normLower(first), normLower(suffix)].join("|");

  return {
    lastName: last,
    firstName: first,
    suffix,
    display: display.trim(),
    key,
  };
}

function parseNamesCell(namesCell) {
  return parseDelimitedList(namesCell, ";")
    .map(parseNameTriplet)
    .filter((p) => p.firstName || p.lastName);
}

// H = Last, First, [Suffix], Meal
function parseMealsCell(mealsCell) {
  const entries = parseDelimitedList(mealsCell, ";");

  return entries.map((entry) => {
    const parts = entry.split(",").map((p) => p.trim());
    const cleaned = parts.filter((p) => p !== "");

    if (cleaned.length < 3) return null;

    const lastName = cleaned[0] || "";
    const firstName = cleaned[1] || "";

    let suffix = "";
    let meal = "";

    if (cleaned.length === 3) {
      meal = cleaned[2] || "";
    } else {
      suffix = cleaned[2] || "";
      meal = cleaned.slice(3).join(", ").trim();
    }

    const key = [normLower(lastName), normLower(firstName), normLower(suffix)].join("|");

    return {
      lastName,
      firstName,
      suffix,
      meal,
      display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
      key,
    };
  }).filter(Boolean);
}

// I = Last, First, [Suffix], Age
function parseAgesCell(agesCell) {
  const entries = parseDelimitedList(agesCell, ";");

  return entries.map((entry) => {
    const parts = entry.split(",").map((p) => p.trim());
    const cleaned = parts.filter((p) => p !== "");

    if (cleaned.length < 3) return null;

    const lastName = cleaned[0] || "";
    const firstName = cleaned[1] || "";

    let suffix = "";
    let ageRaw = "";

    if (cleaned.length === 3) {
      ageRaw = cleaned[2] || "";
    } else {
      suffix = cleaned[2] || "";
      ageRaw = cleaned.slice(3).join(", ").trim();
    }

    const age = /^\d+$/.test(ageRaw) ? Number(ageRaw) : null;
    const key = [normLower(lastName), normLower(firstName), normLower(suffix)].join("|");

    return {
      lastName,
      firstName,
      suffix,
      age,
      ageRaw,
      display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
      key,
    };
  }).filter(Boolean);
}

function mapByKey(arr) {
  const map = new Map();
  arr.forEach((item) => map.set(item.key, item));
  return map;
}

function buildGuestStatuses(row) {
  const allGuests = parseNamesCell(row.names || "");
  const comingGuestsFromSheet = parseNamesCell(row.comingNames || "");
  const meals = parseMealsCell(row.meals || "");
  const ages = parseAgesCell(row.ages || "");

  const comingKeySet = new Set(comingGuestsFromSheet.map((g) => g.key));
  const comingNoSuffixKeySet = new Set(
    comingGuestsFromSheet.map((g) => [normLower(g.lastName), normLower(g.firstName), ""].join("|"))
  );

  const mealsMap = mapByKey(meals);
  const agesMap = mapByKey(ages);

  return allGuests.map((guest) => {
    let status = "pending";

    const guestNoSuffixKey = [normLower(guest.lastName), normLower(guest.firstName), ""].join("|");
    const isMarkedComing =
      comingKeySet.has(guest.key) || comingNoSuffixKeySet.has(guestNoSuffixKey);

    if (row.rsvp === "N") {
      status = "not_coming";
    } else if (row.rsvp === "Y") {
      status = isMarkedComing ? "coming" : "not_coming";
    }

    const mealInfo =
      mealsMap.get(guest.key) ||
      mealsMap.get(guestNoSuffixKey);

    const ageInfo =
      agesMap.get(guest.key) ||
      agesMap.get(guestNoSuffixKey);

    return {
      rowNumber: row.rowNumber,
      partyId: row.partyId,
      email: row.email,
      phone: row.phone,
      cutoffDate: row.cutoffDate,
      entourageGroup: row.entourageGroup,
      rehearsalDinner: row.rehearsalDinner === true,
      hotelGuest: row.hotelGuest === true,
      rsvpPartyStatus: row.rsvp || "",
      status,
      firstName: guest.firstName,
      lastName: guest.lastName,
      suffix: guest.suffix,
      display: guest.display,
      key: guest.key,
      meal: mealInfo?.meal || "",
      age: ageInfo?.age ?? null,
      ageRaw: ageInfo?.ageRaw || "",
    };
  });
}
export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  try {
    const rows = await readGuestRows();

    const parties = rows.map((row) => {
      const guests = buildGuestStatuses(row);
      const comingGuests = guests.filter((g) => g.status === "coming");
      const notComingGuests = guests.filter((g) => g.status === "not_coming");
      const pendingGuests = guests.filter((g) => g.status === "pending");

      return {
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email,
        phone: row.phone,
        cutoffDate: row.cutoffDate,
        rsvp: row.rsvp || "",
        entourageGroup: row.entourageGroup || "",
        rehearsalDinner: row.rehearsalDinner === true,
        hotelGuest: row.hotelGuest === true,
        seatsReserved: row.seatsReserved || "",
        guestCount: guests.length,
        comingCount: comingGuests.length,
        notComingCount: notComingGuests.length,
        pendingCount: pendingGuests.length,
        guests,
      };
    });

    const guests = parties.flatMap((p) => p.guests);

    const entourageGroups = Array.from(
      new Set(
        parties
          .map((p) => p.entourageGroup)
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      parties,
      guests,
      entourageGroups,
    });
  } catch (err) {
    console.error("OVERVIEW DATA ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
