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
