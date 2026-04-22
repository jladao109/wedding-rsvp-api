const API_BASE = "https://wedding-rsvp-api-chi.vercel.app";
const UI_STORAGE_KEY = "admin_seating_arrangement_ui_v1";

const TABLE_LAYOUTS = [
  { id: 1, x: 170, y: 175 },
  { id: 2, x: 325, y: 175 },
  { id: 3, x: 480, y: 175 },
  { id: 4, x: 170, y: 375 },
  { id: 5, x: 325, y: 375 },
  { id: 6, x: 480, y: 375 },
  { id: 7, x: 230, y: 610 },
  { id: 8, x: 390, y: 610 },
  { id: 9, x: 890, y: 175 },
  { id: 10, x: 1045, y: 175 },
  { id: 11, x: 1200, y: 175 },
  { id: 12, x: 890, y: 375 },
  { id: 13, x: 1045, y: 375 },
  { id: 14, x: 1200, y: 375 },
  { id: 15, x: 910, y: 610 },
  { id: 16, x: 1065, y: 610 },
  { id: 17, x: 1220, y: 610 },
  { id: 18, x: 1370, y: 610 }
].map((t) => ({ ...t, size: 10, seatAssignments: [] }));

const FIXED = {
  sweetheart: {
    x: 700,
    y: 138,
    width: 104,
    height: 38,
    label: "SH",
    seats: [
      { name: "Jason Ladao", role: "Groom", side: "Left" },
      { name: "Yvette Bigornia", role: "Bride", side: "Right" }
    ]
  },
  gift: { x: 560, y: 130, r: 24, label: '24"' },
  cake: { x: 840, y: 130, r: 34, label: '36"' },
  danceFloor: { x: 700, y: 405, width: 265, height: 220 },
  dj: { x: 700, y: 700, width: 160, height: 46 },
  photoBooth: { x: 1315, y: 135, width: 58, height: 58 },
  bar: { x: 1335, y: 385, width: 28, height: 112 }
};

const FIXED_GUESTS = [
  { id: "seat-jason", name: "Jason Ladao", partyId: "P000", mealPreference: "N/A", child: "N", childAge: "", role: "Bride and Groom", fixedTable: "SH", table: "SH" },
  { id: "seat-yvette", name: "Yvette Bigornia", partyId: "P000", mealPreference: "N/A", child: "N", childAge: "", role: "Bride and Groom", fixedTable: "SH", table: "SH" }
];

const state = {
  guests: [],
  tables: [],
  selectedSeat: null,
  selectedTableId: null,
  expandedTables: new Set()
};

const els = {};

function qs(id) { return document.getElementById(id); }

function init() {
  els.svg = qs("seatingSvg");
  els.hoverCard = qs("hoverCard");
  els.statusMessage = qs("statusMessage");
  els.unassignedCountPill = qs("unassignedCountPill");
  els.seatedCountPill = qs("seatedCountPill");
  els.tableCountPill = qs("tableCountPill");
  els.tableInspector = qs("tableInspector");
  els.assignPrompt = qs("assignPrompt");
  els.assignSearch = qs("assignSearch");
  els.assignResults = qs("assignResults");
  els.clearSeatBtn = qs("clearSeatBtn");
  els.unassignedGuestsList = qs("unassignedGuestsList");
  els.guestSearch = qs("guestSearch");
  els.adminKey = qs("adminKey");

  bindEvents();
  loadUiState();
  seedFixedGuests();
  renderAll();
}

function bindEvents() {
  qs("loadDataBtn").addEventListener("click", loadData);
  qs("saveDataBtn").addEventListener("click", saveData);
  qs("printLayoutBtn").addEventListener("click", () => window.print());
  qs("expandAllTablesBtn").addEventListener("click", expandAllTables);
  qs("collapseAllTablesBtn").addEventListener("click", collapseAllTables);
  els.assignSearch.addEventListener("input", renderAssignResults);
  els.clearSeatBtn.addEventListener("click", clearSelectedSeat);
  els.guestSearch.addEventListener("input", renderUnassignedGuests);
  document.addEventListener("click", onGlobalClick);
}

function seedFixedGuests() {
  const existingFixedIds = new Set(state.guests.filter((g) => g.fixedTable === "SH").map((g) => g.id));
  FIXED_GUESTS.forEach((guest) => {
    if (!existingFixedIds.has(guest.id)) {
      state.guests.unshift({ ...guest });
    }
  });
}

function saveUiState() {
  try {
    const tablePrefs = state.tables.map((t) => ({ id: t.id, size: t.size }));
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ tablePrefs }));
  } catch {}
}

function loadUiState() {
  state.tables = structuredClone(TABLE_LAYOUTS);
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const prefMap = new Map((parsed.tablePrefs || []).map((t) => [Number(t.id), Number(t.size) || 10]));
    state.tables.forEach((table) => {
      if (prefMap.has(table.id)) {
        const size = prefMap.get(table.id);
        table.size = size === 12 ? 12 : 10;
      }
    });
  } catch {}
}

async function apiPost(path, payload) {
  const adminKey = els.adminKey?.value?.trim();
  if (!adminKey) {
    throw new Error("Please enter the admin key.");
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": adminKey,
    },
    body: JSON.stringify(payload || {}),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || data?.details || "Request failed.");
  }
  return data;
}

function setStatus(message) {
  els.statusMessage.textContent = message;
}

async function loadData() {
  setStatus("Loading seating data from Google Sheets...");
  try {
    const currentPrefs = new Map((state.tables || []).map((t) => [Number(t.id), t.size]));
    const data = await apiPost("/api/seating-load", {});
    state.guests = Array.isArray(data.guests) ? data.guests : [];
    seedFixedGuests();

    const serverTables = Array.isArray(data.tables) ? data.tables : [];
    const serverMap = new Map(serverTables.map((t) => [Number(t.id), t]));
    state.tables = structuredClone(TABLE_LAYOUTS).map((layout) => {
      const existing = serverMap.get(layout.id);
      const sizePref = currentPrefs.get(layout.id);
      return {
        ...layout,
        size: sizePref === 12 ? 12 : 10,
        seatAssignments: Array.isArray(existing?.seatAssignments) ? existing.seatAssignments.slice() : [],
      };
    });

    saveUiState();
    renderAll();
    setStatus(`Loaded ${data.meta?.totalGuests ?? state.guests.length} guest records from Guests/Seating.`);
  } catch (err) {
    setStatus(err.message || "Unable to load seating data.");
  }
}

async function saveData() {
  setStatus("Saving seating assignments to the Seating tab...");
  try {
    const payload = {
      guests: state.guests.map((guest) => ({
        name: guest.name,
        partyId: guest.partyId,
        mealPreference: guest.mealPreference,
        child: guest.child,
        childAge: guest.childAge,
        table: guest.table,
      })),
    };
    const result = await apiPost("/api/seating-save", payload);
    saveUiState();
    setStatus(`Saved ${result.savedCount} seating row${result.savedCount === 1 ? "" : "s"} to Google Sheets.`);
  } catch (err) {
    setStatus(err.message || "Unable to save seating data.");
  }
}

function renderAll() {
  renderStatusPills();
  renderSvgLayout();
  renderInspector();
  renderAssignResults();
  renderUnassignedGuests();
}

function renderStatusPills() {
  const unassigned = getUnassignedGuests();
  const seated = getSeatAssignableGuests().filter((g) => g.table && g.table !== "SH");
  els.unassignedCountPill.textContent = `Unassigned: ${unassigned.length}`;
  els.seatedCountPill.textContent = `Seated: ${seated.length}`;
  els.tableCountPill.textContent = `Tables: ${state.tables.length}`;
}

function getSeatAssignableGuests() {
  return state.guests.filter((g) => !g.fixedTable);
}

function getUnassignedGuests() {
  const q = els.guestSearch.value.trim().toLowerCase();
  return getSeatAssignableGuests()
    .filter((g) => !g.table)
    .filter((g) => {
      if (!q) return true;
      return [g.name, g.partyId, g.mealPreference, g.role].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getAssignedGuest(guestId) {
  return state.guests.find((g) => g.id === guestId) || null;
}

function getTableById(id) {
  return state.tables.find((t) => t.id === id);
}

function renderSvgLayout() {
  els.svg.innerHTML = "";

  const ns = "http://www.w3.org/2000/svg";
  const room = svgEl("path", {
    d: "M78 95 H520 V118 H588 V95 H945 V118 H1014 V95 H1338 V95 H1378 V132 H1378 V720 H1268 V720 H1268 V765 H863 V720 H537 V765 H148 V765 L40 664 V132 H78 Z",
    fill: "var(--room-fill)",
    stroke: "#5d5863",
    "stroke-width": 8,
    "stroke-linejoin": "round"
  }, ns);
  els.svg.appendChild(room);

  drawDoorArcs(ns);
  drawFixedFurniture(ns);

  state.tables.forEach((table) => drawTable(table, ns));
}

function drawDoorArcs(ns) {
  const doorPaths = [
    "M94 108 q28 0 42 18 M136 108 q-28 0 -42 18",
    "M436 108 q28 0 42 18 M478 108 q-28 0 -42 18",
    "M744 108 q28 0 42 18 M786 108 q-28 0 -42 18",
    "M1055 108 q28 0 42 18 M1097 108 q-28 0 -42 18",
    "M1300 98 q26 0 38 16",
    "M58 600 q0 28 20 42 M58 642 q0 -28 20 -42",
    "M437 735 q28 0 42 -18 M479 735 q-28 0 -42 -18",
    "M736 735 q28 0 42 -18 M778 735 q-28 0 -42 -18",
    "M1295 720 q26 0 40 18"
  ];
  doorPaths.forEach((d) => {
    els.svg.appendChild(svgEl("path", {
      d,
      fill: "none",
      stroke: "#1f1f24",
      "stroke-width": 2.5,
      "stroke-dasharray": "10 8",
      "stroke-linecap": "round"
    }, ns));
  });
}

function drawFixedFurniture(ns) {
  const giftLabel = drawInfoLabel(585, 75, '24"', 'gift', '', ns, true);
  els.svg.appendChild(giftLabel);
  const cakeLabel = drawInfoLabel(815, 67, '36"', 'cake', '', ns, true);
  els.svg.appendChild(cakeLabel);
  const shLabel = drawInfoLabel(690, 68, "6'", 'people', '2', ns);
  els.svg.appendChild(shLabel);

  els.svg.appendChild(svgEl("circle", { cx: FIXED.gift.x, cy: FIXED.gift.y, r: FIXED.gift.r, fill: "#fff", stroke: "#2f2f35", "stroke-width": 3 }, ns));
  els.svg.appendChild(iconGift(FIXED.gift.x, FIXED.gift.y, ns));

  els.svg.appendChild(svgEl("circle", { cx: FIXED.cake.x, cy: FIXED.cake.y, r: FIXED.cake.r, fill: "#fff", stroke: "#2f2f35", "stroke-width": 3 }, ns));
  els.svg.appendChild(iconCake(FIXED.cake.x, FIXED.cake.y, ns));

  const shX = FIXED.sweetheart.x - FIXED.sweetheart.width / 2;
  const shY = FIXED.sweetheart.y - FIXED.sweetheart.height / 2;
  els.svg.appendChild(svgEl("rect", { x: shX, y: shY, width: FIXED.sweetheart.width, height: FIXED.sweetheart.height, rx: 0, fill: "#fff", stroke: "#2f2f35", "stroke-width": 3 }, ns));
  els.svg.appendChild(svgText(FIXED.sweetheart.x, FIXED.sweetheart.y + 8, "SH", { "font-size": 28, "font-family": "GothamBold", fill: "#101015", "text-anchor": "middle" }, ns));

  // sweetheart seats
  const shSeats = [
    { cx: FIXED.sweetheart.x - 34, cy: 105, seatNumber: "J", guest: FIXED.sweetheart.seats[0] },
    { cx: FIXED.sweetheart.x + 34, cy: 105, seatNumber: "Y", guest: FIXED.sweetheart.seats[1] }
  ];
  shSeats.forEach((seat) => {
    const circle = svgEl("circle", { cx: seat.cx, cy: seat.cy, r: 13, fill: "#fff", stroke: "#2f2f35", "stroke-width": 2 }, ns);
    circle.addEventListener("mouseenter", (e) => showHoverCard(e, `<h4>${seat.guest.role}</h4><p>${seat.guest.name}</p><p>Sweetheart Table</p>`));
    circle.addEventListener("mouseleave", hideHoverCard);
    els.svg.appendChild(circle);
    els.svg.appendChild(svgText(seat.cx, seat.cy + 4, seat.seatNumber, { "font-size": 11, "font-family": "GothamBold", fill: "#111" }, ns));
  });

  els.svg.appendChild(svgEl("rect", {
    x: FIXED.danceFloor.x - FIXED.danceFloor.width / 2,
    y: FIXED.danceFloor.y - FIXED.danceFloor.height / 2,
    width: FIXED.danceFloor.width,
    height: FIXED.danceFloor.height,
    rx: 20,
    fill: "#6d6a72"
  }, ns));
  els.svg.appendChild(iconDance(FIXED.danceFloor.x, FIXED.danceFloor.y, ns));

  els.svg.appendChild(svgEl("rect", {
    x: FIXED.dj.x - FIXED.dj.width / 2,
    y: FIXED.dj.y - FIXED.dj.height / 2,
    width: FIXED.dj.width,
    height: FIXED.dj.height,
    rx: 10,
    fill: "#ffffff",
    stroke: "#2f2f35",
    "stroke-width": 3
  }, ns));
  els.svg.appendChild(iconDJ(FIXED.dj.x, FIXED.dj.y, ns));

  els.svg.appendChild(svgEl("rect", {
    x: FIXED.photoBooth.x - FIXED.photoBooth.width / 2,
    y: FIXED.photoBooth.y - FIXED.photoBooth.height / 2,
    width: FIXED.photoBooth.width,
    height: FIXED.photoBooth.height,
    rx: 4,
    fill: "#fff",
    stroke: "#2f2f35",
    "stroke-width": 3
  }, ns));
  els.svg.appendChild(iconCamera(FIXED.photoBooth.x, FIXED.photoBooth.y, ns));

  els.svg.appendChild(svgEl("rect", {
    x: FIXED.bar.x - FIXED.bar.width / 2,
    y: FIXED.bar.y - FIXED.bar.height / 2,
    width: FIXED.bar.width,
    height: FIXED.bar.height,
    rx: 2,
    fill: "#fff",
    stroke: "#2f2f35",
    "stroke-width": 3
  }, ns));
  els.svg.appendChild(iconBar(FIXED.bar.x, FIXED.bar.y, ns));
  els.svg.appendChild(svgEl("rect", {
    x: 1362,
    y: 365,
    width: 36,
    height: 66,
    rx: 8,
    fill: "#76727e"
  }, ns));
  els.svg.appendChild(svgText(1380, 409, "8'", { "font-size": 24, "font-family": "GothamBold", fill: "#fff", transform: "rotate(90 1380 409)" }, ns));
}

function drawTable(table, ns) {
  const capacity = table.size || 10;
  const tableRadius = capacity === 12 ? 42 : 38;
  const seatRadius = 13;
  const seatRingRadius = tableRadius + 24;

  els.svg.appendChild(drawInfoLabel(table.x, table.y - 94, '66"', 'people', String(capacity), ns));

  const group = svgEl("g", { class: "table-group" }, ns);
  const tableCircle = svgEl("circle", {
    cx: table.x,
    cy: table.y,
    r: tableRadius,
    fill: "#fff",
    stroke: "#2f2f35",
    "stroke-width": 3
  }, ns);
  group.appendChild(tableCircle);
  group.appendChild(svgText(table.x, table.y + 13, String(table.id), {
    "font-size": 34,
    "font-family": "GothamBold",
    fill: "#111",
    "text-anchor": "middle"
  }, ns));

  const seats = computeSeatPositions(table.x, table.y, seatRingRadius, capacity);

  seats.forEach((seatPos, index) => {
    const assignedGuestId = table.seatAssignments[index] || null;
    const guest = assignedGuestId ? getAssignedGuest(assignedGuestId) : null;
    const seatCircle = svgEl("circle", {
      cx: seatPos.x,
      cy: seatPos.y,
      r: seatRadius,
      fill: guest ? "var(--seat-filled)" : "var(--seat-empty)",
      stroke: "#2f2f35",
      "stroke-width": 2
    }, ns);

    seatCircle.addEventListener("click", (e) => {
      e.stopPropagation();
      selectSeat(table.id, index);
    });

    seatCircle.addEventListener("mouseenter", (e) => {
      const content = guest
        ? `<h4>Seat ${index + 1}</h4><p><strong>${guest.name}</strong></p><p>Party ${guest.partyId} • ${guest.mealPreference}</p><p>Table ${table.id}</p>`
        : `<h4>Seat ${index + 1}</h4><p>Empty seat at table ${table.id}</p><p>Click to assign a guest.</p>`;
      showHoverCard(e, content);
    });
    seatCircle.addEventListener("mouseleave", hideHoverCard);

    group.appendChild(seatCircle);
    group.appendChild(svgText(seatPos.x, seatPos.y + 4, String(index + 1), {
      "font-size": 11,
      "font-family": "GothamBold",
      fill: "#111",
      "text-anchor": "middle"
    }, ns));
  });

  tableCircle.addEventListener("click", (e) => {
    e.stopPropagation();
    state.selectedTableId = table.id;
    renderInspector();
  });
  tableCircle.addEventListener("mouseenter", (e) => {
    const seatedGuests = table.seatAssignments.map(getAssignedGuest).filter(Boolean);
    const items = seatedGuests.length
      ? `<ul>${seatedGuests.map((g) => `<li>${g.name} • ${g.mealPreference}</li>`).join("")}</ul>`
      : "<p>No guests assigned yet.</p>";
    showHoverCard(e, `<h4>Table ${table.id}</h4><p>${seatedGuests.length} of ${capacity} seats used</p>${items}`);
  });
  tableCircle.addEventListener("mouseleave", hideHoverCard);

  els.svg.appendChild(group);
}

function drawInfoLabel(x, y, leftText, iconType, rightText, ns, compact = false) {
  const width = compact ? 76 : 100;
  const height = 32;
  const group = svgEl("g", {}, ns);
  group.appendChild(svgEl("rect", {
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    rx: 8,
    fill: "#74707c"
  }, ns));
  group.appendChild(svgText(x - (compact ? 4 : 18), y + 5, leftText, {
    "font-size": compact ? 12 : 11,
    "font-family": "GothamBold",
    fill: "#fff",
    "text-anchor": compact ? "middle" : "end"
  }, ns));

  if (!compact) {
    if (iconType === "people") group.appendChild(iconPeople(x + 1, y, ns, "#fff"));
    if (iconType === "gift") group.appendChild(iconGift(x + 8, y + 1, ns, "#fff", 0.55));
    if (iconType === "cake") group.appendChild(iconCake(x + 8, y + 1, ns, "#fff", 0.55));
    group.appendChild(svgText(x + 22, y + 5, rightText, {
      "font-size": 11,
      "font-family": "GothamBold",
      fill: "#fff",
      "text-anchor": "middle"
    }, ns));
  }
  return group;
}

function computeSeatPositions(cx, cy, radius, count) {
  const positions = [];
  const startAngle = -Math.PI / 2;
  for (let i = 0; i < count; i += 1) {
    const angle = startAngle + (Math.PI * 2 * i) / count;
    positions.push({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
  }
  return positions;
}

function selectSeat(tableId, seatIndex) {
  state.selectedSeat = { tableId, seatIndex };
  state.selectedTableId = tableId;
  els.assignSearch.disabled = false;
  els.clearSeatBtn.disabled = false;
  els.assignSearch.value = "";
  renderInspector();
  renderAssignResults();
}

function clearSelectedSeat() {
  if (!state.selectedSeat) return;
  const table = getTableById(state.selectedSeat.tableId);
  const guestId = table.seatAssignments[state.selectedSeat.seatIndex];
  if (guestId) {
    const guest = getAssignedGuest(guestId);
    if (guest) guest.table = "";
  }
  table.seatAssignments[state.selectedSeat.seatIndex] = null;
  saveUiState();
  renderAll();
  setStatus(`Cleared seat ${state.selectedSeat.seatIndex + 1} at table ${state.selectedSeat.tableId}.`);
}

function renderInspector() {
  if (!state.selectedTableId) {
    els.tableInspector.textContent = "Select a table or seat to edit seating.";
    return;
  }

  const table = getTableById(state.selectedTableId);
  if (!table) {
    els.tableInspector.textContent = "Select a table or seat to edit seating.";
    return;
  }

  const seatedGuests = table.seatAssignments
    .map((guestId, index) => ({ guest: guestId ? getAssignedGuest(guestId) : null, index }))
    .filter((item) => item.guest);

  const seatButtons = seatedGuests.length
    ? seatedGuests.map(({ guest, index }) => `
        <button class="inspector-seat-item" type="button" data-seat-index="${index}">
          <strong>Seat ${index + 1}: ${guest.name}</strong>
          <span>Party ${guest.partyId} • ${guest.mealPreference}</span>
        </button>
      `).join("")
    : `<div class="small-note">No guests assigned yet.</div>`;

  els.tableInspector.innerHTML = `
    <div class="small-note" style="margin-bottom:10px; text-align:center;">
      <strong>Table ${table.id}</strong><br>
      ${table.seatAssignments.filter(Boolean).length} of ${table.size} seats used
    </div>
    <div class="assign-panel-actions" style="margin-bottom:12px; gap:8px; flex-wrap:wrap;">
      <button class="section-control-btn secondary" type="button" id="toggleTableSizeBtn">${table.size === 10 ? "Switch to 12" : "Switch to 10"}</button>
      <button class="section-control-btn secondary" type="button" id="addSeatBtn" ${table.seatAssignments.filter(Boolean).length >= table.size ? "disabled" : ""}>Add Seat +</button>
      <button class="section-control-btn secondary" type="button" id="removeSeatBtn" ${table.seatAssignments.filter(Boolean).length === 0 ? "disabled" : ""}>Remove Last Seat</button>
    </div>
    <div>${seatButtons}</div>
  `;

  qs("toggleTableSizeBtn").addEventListener("click", () => toggleTableSize(table.id));
  qs("addSeatBtn").addEventListener("click", () => addSeat(table.id));
  qs("removeSeatBtn").addEventListener("click", () => removeSeat(table.id));
  els.tableInspector.querySelectorAll(".inspector-seat-item").forEach((btn) => {
    btn.addEventListener("click", () => selectSeat(table.id, Number(btn.dataset.seatIndex)));
  });
}

function renderAssignResults() {
  if (!state.selectedSeat) {
    els.assignPrompt.textContent = "Click an empty seat to assign a guest.";
    els.assignResults.className = "assign-results empty-state";
    els.assignResults.textContent = "No seat selected.";
    els.assignSearch.disabled = true;
    els.clearSeatBtn.disabled = true;
    return;
  }

  const table = getTableById(state.selectedSeat.tableId);
  const seatNumber = state.selectedSeat.seatIndex + 1;
  const search = els.assignSearch.value.trim().toLowerCase();
  const assignedGuestId = table.seatAssignments[state.selectedSeat.seatIndex];
  const assignedGuest = assignedGuestId ? getAssignedGuest(assignedGuestId) : null;

  els.assignPrompt.textContent = assignedGuest
    ? `Seat ${seatNumber} at table ${table.id} is assigned to ${assignedGuest.name}. Select another guest to replace.`
    : `Seat ${seatNumber} at table ${table.id} is empty. Search and assign a guest.`;

  const candidates = getSeatAssignableGuests()
    .filter((g) => !g.table || g.id === assignedGuestId)
    .filter((g) => {
      if (!search) return true;
      return [g.name, g.partyId, g.mealPreference, g.role].join(" ").toLowerCase().includes(search);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!candidates.length) {
    els.assignResults.className = "assign-results empty-state";
    els.assignResults.textContent = "No matching guests found.";
    return;
  }

  els.assignResults.className = "assign-results";
  els.assignResults.innerHTML = candidates.map((guest) => `
    <button class="assign-result-item" type="button" data-guest-id="${guest.id}">
      <strong>${guest.name}</strong>
      <span>Party ${guest.partyId} • ${guest.mealPreference} • ${guest.child === "Y" ? `Child age ${guest.childAge}` : "Adult"}</span>
    </button>
  `).join("");

  els.assignResults.querySelectorAll(".assign-result-item").forEach((btn) => {
    btn.addEventListener("click", () => assignGuestToSelectedSeat(btn.dataset.guestId));
  });
}

function renderUnassignedGuests() {
  const guests = getUnassignedGuests();
  if (!guests.length) {
    els.unassignedGuestsList.innerHTML = `<div class="empty-state">All guests are assigned.</div>`;
    renderStatusPills();
    return;
  }

  els.unassignedGuestsList.innerHTML = guests.map((guest) => `
    <button class="unassigned-guest-item" type="button" data-guest-id="${guest.id}">
      <strong>${guest.name}</strong>
      <span>Party ${guest.partyId} • ${guest.mealPreference} • ${guest.child === "Y" ? `Child age ${guest.childAge}` : "Adult"}</span>
    </button>
  `).join("");

  els.unassignedGuestsList.querySelectorAll(".unassigned-guest-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const guest = getAssignedGuest(btn.dataset.guestId);
      setStatus(`${guest.name} is unassigned. Click an empty seat, then select this guest from the assign panel.`);
    });
  });

  renderStatusPills();
}

function assignGuestToSelectedSeat(guestId) {
  if (!state.selectedSeat) return;
  const table = getTableById(state.selectedSeat.tableId);
  const guest = getAssignedGuest(guestId);
  if (!table || !guest) return;

  // clear previous seat if guest already assigned elsewhere
  if (guest.table) {
    const oldTable = getTableById(Number(guest.table));
    if (oldTable) {
      oldTable.seatAssignments = oldTable.seatAssignments.map((id) => id === guest.id ? null : id);
    }
  }

  const existingGuestId = table.seatAssignments[state.selectedSeat.seatIndex];
  if (existingGuestId && existingGuestId !== guest.id) {
    const existingGuest = getAssignedGuest(existingGuestId);
    if (existingGuest) existingGuest.table = "";
  }

  table.seatAssignments[state.selectedSeat.seatIndex] = guest.id;
  guest.table = String(table.id);
  saveUiState();
  renderAll();
  setStatus(`${guest.name} assigned to table ${table.id}, seat ${state.selectedSeat.seatIndex + 1}.`);
}

function addSeat(tableId) {
  const table = getTableById(tableId);
  if (!table || table.seatAssignments.length >= table.size) return;
  while (table.seatAssignments.length < table.size && table.seatAssignments[table.seatAssignments.length - 1] !== undefined) {
    break;
  }
  table.seatAssignments.push(null);
  saveUiState();
  renderAll();
  setStatus(`Added seat ${table.seatAssignments.length} to table ${table.id}.`);
}

function removeSeat(tableId) {
  const table = getTableById(tableId);
  if (!table || !table.seatAssignments.length) return;
  const guestId = table.seatAssignments[table.seatAssignments.length - 1];
  if (guestId) {
    const guest = getAssignedGuest(guestId);
    if (guest) guest.table = "";
  }
  table.seatAssignments.pop();
  if (state.selectedSeat && state.selectedSeat.tableId === tableId && state.selectedSeat.seatIndex >= table.seatAssignments.length) {
    state.selectedSeat = null;
  }
  saveUiState();
  renderAll();
  setStatus(`Removed the last seat from table ${table.id}.`);
}

function toggleTableSize(tableId) {
  const table = getTableById(tableId);
  if (!table) return;
  const newSize = table.size === 10 ? 12 : 10;
  const assignedCount = table.seatAssignments.filter(Boolean).length;
  if (assignedCount > newSize) {
    setStatus(`Table ${table.id} already has ${assignedCount} assigned guests. Remove seats or guests before switching to ${newSize}.`);
    return;
  }
  table.size = newSize;
  if (table.seatAssignments.length > newSize) {
    table.seatAssignments = table.seatAssignments.slice(0, newSize);
  }
  saveUiState();
  renderAll();
  setStatus(`Table ${table.id} switched to ${newSize} seats.`);
}

function expandAllTables() {
  state.tables.forEach((table) => {
    while (table.seatAssignments.length < table.size) table.seatAssignments.push(null);
  });
  saveUiState();
  renderAll();
  setStatus("Expanded all tables to show their full seat capacity.");
}

function collapseAllTables() {
  state.tables.forEach((table) => {
    const assigned = table.seatAssignments.filter(Boolean);
    table.seatAssignments = assigned.slice();
  });
  saveUiState();
  renderAll();
  setStatus("Collapsed all tables to show only assigned seats.");
}

function onGlobalClick(e) {
  if (!e.target.closest(".panel-card") && !e.target.closest("svg")) {
    hideHoverCard();
  }
}

function showHoverCard(event, html) {
  const wrap = els.svg.getBoundingClientRect();
  const pointX = event.clientX - wrap.left + 18;
  const pointY = event.clientY - wrap.top + 18;
  els.hoverCard.innerHTML = html;
  els.hoverCard.classList.remove("hidden");
  els.hoverCard.style.left = `${pointX}px`;
  els.hoverCard.style.top = `${pointY}px`;
}

function hideHoverCard() {
  els.hoverCard.classList.add("hidden");
}

function svgEl(tag, attrs, ns) {
  const el = document.createElementNS(ns, tag);
  Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function svgText(x, y, text, attrs, ns) {
  const el = svgEl("text", { x, y, ...attrs }, ns);
  el.textContent = text;
  return el;
}

function iconPeople(x, y, ns, color = "#fff") {
  const g = svgEl("g", { transform: `translate(${x - 7} ${y - 7}) scale(0.9)` }, ns);
  g.appendChild(svgEl("circle", { cx: 5, cy: 5, r: 3.2, fill: color }, ns));
  g.appendChild(svgEl("rect", { x: 2.8, y: 9, width: 4.5, height: 6, rx: 2.2, fill: color }, ns));
  g.appendChild(svgEl("circle", { cx: 13, cy: 5, r: 3.2, fill: color, opacity: 0.9 }, ns));
  g.appendChild(svgEl("rect", { x: 10.8, y: 9, width: 4.5, height: 6, rx: 2.2, fill: color, opacity: 0.9 }, ns));
  return g;
}

function iconGift(x, y, ns, color = "#2f2f35", scale = 1) {
  const g = svgEl("g", { transform: `translate(${x - 10 * scale} ${y - 10 * scale}) scale(${scale})` }, ns);
  g.appendChild(svgEl("rect", { x: 3, y: 8, width: 14, height: 10, rx: 2, fill: "none", stroke: color, "stroke-width": 2 }, ns));
  g.appendChild(svgEl("path", { d: "M10 8 V18 M3 12 H17", fill: "none", stroke: color, "stroke-width": 2 }, ns));
  g.appendChild(svgEl("path", { d: "M10 8 C10 4,5 4,5 7 C5 8.5,6.5 9,8 9 M10 8 C10 4,15 4,15 7 C15 8.5,13.5 9,12 9", fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round" }, ns));
  return g;
}

function iconCake(x, y, ns, color = "#2f2f35", scale = 1) {
  const g = svgEl("g", { transform: `translate(${x - 12 * scale} ${y - 12 * scale}) scale(${scale})` }, ns);
  g.appendChild(svgEl("rect", { x: 6, y: 14, width: 12, height: 5, rx: 2, fill: "none", stroke: color, "stroke-width": 2 }, ns));
  g.appendChild(svgEl("rect", { x: 8, y: 9, width: 8, height: 4, rx: 2, fill: "none", stroke: color, "stroke-width": 2 }, ns));
  g.appendChild(svgEl("path", { d: "M12 6 V9", fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round" }, ns));
  g.appendChild(svgEl("path", { d: "M12 4 C13.5 5 13.3 6.2 12 6 C10.7 6.2 10.5 5 12 4", fill: color }, ns));
  return g;
}

function iconCamera(x, y, ns) {
  const g = svgEl("g", { transform: `translate(${x - 13} ${y - 10})` }, ns);
  g.appendChild(svgEl("rect", { x: 1, y: 4, width: 24, height: 16, rx: 3, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  g.appendChild(svgEl("circle", { cx: 13, cy: 12, r: 4.5, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  g.appendChild(svgEl("rect", { x: 5, y: 1, width: 6, height: 4, rx: 1.5, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  return g;
}

function iconDance(x, y, ns) {
  const g = svgEl("g", { transform: `translate(${x - 32} ${y - 26})` }, ns);
  g.appendChild(svgEl("circle", { cx: 20, cy: 10, r: 6, fill: "#fff" }, ns));
  g.appendChild(svgEl("path", { d: "M20 16 L18 28 L10 38 M18 28 L28 34 M20 18 L31 21 L38 14", fill: "none", stroke: "#fff", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" }, ns));
  g.appendChild(svgEl("circle", { cx: 48, cy: 16, r: 6, fill: "#fff", opacity: 0.9 }, ns));
  g.appendChild(svgEl("path", { d: "M48 22 L46 34 L40 44 M46 34 L56 40 M48 24 L58 27 L66 20", fill: "none", stroke: "#fff", "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.9 }, ns));
  return g;
}

function iconDJ(x, y, ns) {
  const g = svgEl("g", { transform: `translate(${x - 28} ${y - 13})` }, ns);
  g.appendChild(svgEl("rect", { x: 2, y: 2, width: 52, height: 22, rx: 4, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  g.appendChild(svgEl("circle", { cx: 16, cy: 13, r: 6, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  g.appendChild(svgEl("circle", { cx: 39, cy: 13, r: 6, fill: "none", stroke: "#2f2f35", "stroke-width": 2 }, ns));
  g.appendChild(svgEl("rect", { x: 24, y: 6, width: 7, height: 14, rx: 2, fill: "#2f2f35" }, ns));
  return g;
}

function iconBar(x, y, ns) {
  const g = svgEl("g", { transform: `translate(${x - 7} ${y - 18}) rotate(-90 7 18)` }, ns);
  g.appendChild(svgEl("path", { d: "M7 3 v14 M2 3 h10 M4 17 h6", fill: "none", stroke: "#2f2f35", "stroke-width": 2, "stroke-linecap": "round" }, ns));
  return g;
}

window.addEventListener("DOMContentLoaded", init);
