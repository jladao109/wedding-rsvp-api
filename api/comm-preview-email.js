import {
  setCors,
  requireAdminKey,
  readGuestRows,
  getEmailRecipients,
  buildTextFromHtml,
  norm,
  normLower,
  isValidEmail,
} from "./_comm-helpers.js";

function normalizeStringList(input) {
  if (Array.isArray(input)) {
    return input.map((x) => normLower(x)).filter(Boolean);
  }

  return String(input || "")
    .split(/[\n,;]+/)
    .map((x) => normLower(x))
    .filter(Boolean);
}

function normalizePartyIdList(input) {
  if (Array.isArray(input)) {
    return input.map((x) => normLower(x)).filter(Boolean);
  }

  return String(input || "")
    .split(/[\n,;]+/)
    .map((x) => normLower(x))
    .filter(Boolean);
}

function normalizeRowNumberList(input) {
  let values = [];

  if (Array.isArray(input)) {
    values = input;
  } else {
    values = String(input || "")
      .split(/[\n,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  return values
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);
}

function audienceMatch(row, audience) {
  const a = normLower(audience);
  const group = normLower(row.entourageGroup);
  const BOTH = "bridesmaid and groomsman";
  const GROOMSMAN_AND_SPONSOR = "groomsman and sponsor";

  if (a === "all") return true;
  if (a === "guests") return !norm(row.entourageGroup);
  if (a === "entourage") return !!norm(row.entourageGroup);
  if (a === "parents") return group === "parents";
  if (a === "groomsmen") {
    return (
      group === "groomsmen" ||
      group === BOTH ||
      group === GROOMSMAN_AND_SPONSOR
    );
  }
  if (a === "bridesmaids") return group === "bridesmaids" || group === BOTH;
  if (a === "sponsors") {
    return group === "sponsors" || group === GROOMSMAN_AND_SPONSOR;
  }
  if (a === "rehearsal") return row.rehearsalDinner === true;
  if (a === "hotel") return row.hotelGuest === true;

  return false;
}

function matchesManualInclude(row, payload) {
  const includePartyIds = normalizePartyIdList(payload?.includePartyIds || []);
  const includeRowNumbers = normalizeRowNumberList(payload?.includeRowNumbers || []);

  return (
    includePartyIds.includes(normLower(row.partyId)) ||
    includeRowNumbers.includes(Number(row.rowNumber))
  );
}

function matchesManualExclude(row, payload) {
  const excludePartyIds = normalizePartyIdList(payload?.excludePartyIds || []);
  const excludeRowNumbers = normalizeRowNumberList(payload?.excludeRowNumbers || []);

  return (
    excludePartyIds.includes(normLower(row.partyId)) ||
    excludeRowNumbers.includes(Number(row.rowNumber))
  );
}

function getFilteredOutReasons(rows, payload) {
  const includeList = normalizeStringList(payload?.includeAudiences || []);
  const excludeList = normalizeStringList(payload?.excludeAudiences || []);

  const seenEmails = new Set();
  const filteredOut = [];

  rows.forEach((row) => {
    const includedByAudience =
      includeList.length > 0
        ? includeList.some((a) => audienceMatch(row, a))
        : false;

    const includedByManual = matchesManualInclude(row, payload);
    const included = includedByAudience || includedByManual;

    if (!included) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: "Did not match selected include audiences or manual includes.",
      });
      return;
    }

    if (excludeList.some((a) => audienceMatch(row, a))) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: "Matched an excluded audience.",
      });
      return;
    }

    if (matchesManualExclude(row, payload)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: "Matched a manually excluded Party ID or row number.",
      });
      return;
    }

    if (row.rsvp !== "Y") {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: `RSVP is "${row.rsvp || "blank"}" instead of "Y".`,
      });
      return;
    }

    if (!isValidEmail(row.email)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: "Missing or invalid email address.",
      });
      return;
    }

    const emailKey = normLower(row.email);
    if (seenEmails.has(emailKey)) {
      filteredOut.push({
        rowNumber: row.rowNumber,
        partyId: row.partyId,
        email: row.email || "",
        entourageGroup: row.entourageGroup || "",
        reason: "Duplicate email address already included earlier in the preview.",
      });
      return;
    }

    seenEmails.add(emailKey);
  });

  return filteredOut;
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!requireAdminKey(req, res)) return;

  const subject = String(req.body?.subject || "").trim();
  const html = String(req.body?.html || "").trim();

  if (!subject) {
    return res.status(400).json({ error: "Subject is required." });
  }
  if (!html) {
    return res.status(400).json({ error: "HTML is required." });
  }

  try {
    const rows = await readGuestRows();
    const recipients = getEmailRecipients(rows, req.body || {});
    const text = buildTextFromHtml(html);
    const filteredOut = getFilteredOutReasons(rows, req.body || {});

    const emailCounts = {};
    rows.forEach((r) => {
      const email = String(r.email || "").toLowerCase().trim();
      if (!email) return;
      emailCounts[email] = (emailCounts[email] || 0) + 1;
    });

    const duplicateEmails = Object.entries(emailCounts)
      .filter(([, count]) => count > 1)
      .map(([email, count]) => ({ email, count }));

    return res.json({
      ok: true,
      count: recipients.length,
      recipients,
      filteredOut,
      debug: {
        duplicateEmails,
        totalRows: rows.length,
        textLength: text.length,
      },
    });
  } catch (err) {
    console.error("COMM PREVIEW ERROR:", err);
    return res.status(500).json({
      error: "Server error",
      details: err?.message || String(err),
    });
  }
}
