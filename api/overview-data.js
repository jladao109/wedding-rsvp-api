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
  const noSuffixKey = [normLower(last), normLower(first), ""].join("|");

  return {
    lastName: last,
    firstName: first,
    suffix,
    display: display.trim(),
    key,
    noSuffixKey,
  };
}

function parseNamesCell(namesCell) {
  return parseDelimitedList(namesCell, ";")
    .map(parseNameTriplet)
    .filter((p) => p.firstName || p.lastName);
}

// G = Last, First, [Suffix]
function parseComingNamesCell(comingNamesCell) {
  return parseDelimitedList(comingNamesCell, ";")
    .map((entry) => {
      const parts = entry.split(",").map((p) => p.trim());
      const last = parts[0] ?? "";
      const first = parts[1] ?? "";
      const suffix = parts[2] ?? "";

      const display = [first, last, suffix].filter(Boolean).join(" ");
      const key = [normLower(last), normLower(first), normLower(suffix)].join("|");
      const noSuffixKey = [normLower(last), normLower(first), ""].join("|");

      return {
        lastName: last,
        firstName: first,
        suffix,
        display: display.trim(),
        key,
        noSuffixKey,
      };
    })
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
    const noSuffixKey = [normLower(lastName), normLower(firstName), ""].join("|");

    return {
      lastName,
      firstName,
      suffix,
      meal,
      display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
      key,
      noSuffixKey,
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
    const noSuffixKey = [normLower(lastName), normLower(firstName), ""].join("|");

    return {
      lastName,
      firstName,
      suffix,
      age,
      ageRaw,
      display: [firstName, lastName, suffix].filter(Boolean).join(" ").trim(),
      key,
      noSuffixKey,
    };
  }).filter(Boolean);
}

function mapByKeyWithFallback(arr) {
  const map = new Map();

  arr.forEach((item) => {
    map.set(item.key, item);
    if (!map.has(item.noSuffixKey)) {
      map.set(item.noSuffixKey, item);
    }
  });

  return map;
}

function buildGuestStatuses(row) {
  const allGuests = parseNamesCell(row.names || "");
  const comingGuestsFromSheet = parseComingNamesCell(row.comingNames || "");
  const mealsMap = mapByKeyWithFallback(parseMealsCell(row.meals || ""));
  const agesMap = mapByKeyWithFallback(parseAgesCell(row.ages || ""));

  const allByExact = new Map(allGuests.map((g) => [g.key, g]));
  const allByNoSuffix = new Map(allGuests.map((g) => [g.noSuffixKey, g]));

  const usedInvitedKeys = new Set();
  const guestStatuses = [];

  // Source of truth for "coming" = Column G
  comingGuestsFromSheet.forEach((guestFromG) => {
    const invitedGuest =
      allByExact.get(guestFromG.key) ||
      allByNoSuffix.get(guestFromG.noSuffixKey);

    const baseGuest = invitedGuest || guestFromG;

    if (invitedGuest) {
      usedInvitedKeys.add(invitedGuest.key);
    }

    const mealInfo =
      mealsMap.get(baseGuest.key) ||
      mealsMap.get(baseGuest.noSuffixKey);

    const ageInfo =
      agesMap.get(baseGuest.key) ||
      agesMap.get(baseGuest.noSuffixKey);

    guestStatuses.push({
      rowNumber: row.rowNumber,
      partyId: row.partyId,
      email: row.email,
      phone: row.phone,
      cutoffDate: row.cutoffDate,
      entourageGroup: row.entourageGroup,
      rehearsalDinner: row.rehearsalDinner === true,
      hotelGuest: row.hotelGuest === true,
      rsvpPartyStatus: row.rsvp || "",
      status: "coming",
      firstName: baseGuest.firstName,
      lastName: baseGuest.lastName,
      suffix: baseGuest.suffix,
      display: baseGuest.display,
      key: baseGuest.key,
      noSuffixKey: baseGuest.noSuffixKey,
      meal: mealInfo?.meal || "",
      age: ageInfo?.age ?? null,
      ageRaw: ageInfo?.ageRaw || "",
    });
  });

  // Everyone else from Column B is not coming or pending
  allGuests.forEach((guest) => {
    if (usedInvitedKeys.has(guest.key)) return;

    const mealInfo =
      mealsMap.get(guest.key) ||
      mealsMap.get(guest.noSuffixKey);

    const ageInfo =
      agesMap.get(guest.key) ||
      agesMap.get(guest.noSuffixKey);

    let status = "pending";
    if (row.rsvp === "N") {
      status = "not_coming";
    } else if (row.rsvp === "Y") {
      status = "not_coming";
    }

    guestStatuses.push({
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
      noSuffixKey: guest.noSuffixKey,
      meal: mealInfo?.meal || "",
      age: ageInfo?.age ?? null,
      ageRaw: ageInfo?.ageRaw || "",
    });
  });

  return guestStatuses;
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
