/**
 * background.js — MV3 service worker (Chrome + Firefox compatible)
 *
 * State is kept in memory after an initial storage restore. Incoming messages
 * wait for that restore, preventing an early capture from being overwritten by
 * stale persisted state. Storage writes are debounced to avoid racing batches.
 *
 * chrome.storage.session is available in Chrome 102+ and Firefox 128+.
 * Falls back to chrome.storage.local if session storage is unavailable.
 *
 * Message API (chrome.runtime.sendMessage):
 *   { type: "GET_STATE" }                           → full state object
 *   { type: "CLEAR" }                               → { ok: true }
 *   { type: "STUDENT_BATCH", rows }                 → { ok: true, total }
 *   { type: "PAIRING_BATCH", rows }                 → { ok: true, total }
 *   { type: "CLASS_BATCH",   rows }                 → { ok: true, total }
 *   { type: "STAFF_BATCH",   rows }                 → { ok: true, total }
 *   { type: "BULK_PROGRESS", done, total, label }   → { ok: true }
 */

const store = chrome.storage.session ?? chrome.storage.local;

function createDefaultState() {
  return {
    students:  [],
    pairings:  [],
    classes:   [],
    staff:     [],
    pageCount: 0,
    bulkDone:  0,
    bulkTotal: 0,
    bulkLabel: "",
  };
}

const DEFAULTS = createDefaultState();

// In-memory state — always authoritative; no async reads on message receipt.
let mem = createDefaultState();

function normalizeState(saved = {}) {
  const defaults = createDefaultState();
  return {
    students: Array.isArray(saved.students) ? saved.students : defaults.students,
    pairings: Array.isArray(saved.pairings) ? saved.pairings : defaults.pairings,
    classes: Array.isArray(saved.classes) ? saved.classes : defaults.classes,
    staff: Array.isArray(saved.staff) ? saved.staff : defaults.staff,
    pageCount: Number.isFinite(saved.pageCount) ? saved.pageCount : defaults.pageCount,
    bulkDone: Number.isFinite(saved.bulkDone) ? saved.bulkDone : defaults.bulkDone,
    bulkTotal: Number.isFinite(saved.bulkTotal) ? saved.bulkTotal : defaults.bulkTotal,
    bulkLabel: typeof saved.bulkLabel === "string" ? saved.bulkLabel : defaults.bulkLabel,
  };
}

// Old stored states may not have `staff` or bulk-progress fields. Normalizing
// keeps them readable while restricting restoration to known state keys.
const stateReady = new Promise((resolve) => {
  store.get(DEFAULTS, (saved) => {
    mem = normalizeState(saved);
    resolve();
  });
});

function clean(value) {
  return String(value ?? "").trim();
}

function recordKey(type, row) {
  switch (type) {
    case "STUDENT_BATCH":
      return clean(row["Student ID"]) || [row["Student First Name"], row["Student Last Name"], row.DOB]
        .map(clean).join("|").toLowerCase();
    case "CLASS_BATCH":
      return [row["Class ID"], row.instructor_id].map(clean).join("|");
    case "STAFF_BATCH":
      return clean(row["Staff ID"] || row.staffId);
    case "PAIRING_BATCH":
      return [row.swimmer_id, row.class_id, row.instructor_id, row.session].map(clean).join("|");
    default:
      return "";
  }
}

function mergeRows(existing, incoming, type) {
  const merged = new Map();
  [...existing, ...incoming].forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return;
    const key = recordKey(type, row) || `__missing__:${index}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...row });
      return;
    }
    for (const [field, value] of Object.entries(row)) {
      if (!clean(previous[field]) && clean(value)) previous[field] = value;
    }
  });
  return [...merged.values()];
}

// Debounced storage sync — avoids hammering storage on rapid-fire messages.
let syncTimer = null;
function scheduleSync() {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => store.set({ ...mem }), 200);
}

function handleMessage(msg, sendResponse) {
  switch (msg.type) {
    case "STUDENT_BATCH":
      {
        const previousTotal = mem.students.length;
        mem.students = mergeRows(
          mem.students,
          Array.isArray(msg.rows) ? msg.rows : [],
          msg.type
        );
        if (mem.students.length > previousTotal) mem.pageCount += 1;
      }
      scheduleSync();
      sendResponse({ ok: true, total: mem.students.length });
      break;

    case "PAIRING_BATCH":
      mem.pairings = mergeRows(mem.pairings, Array.isArray(msg.rows) ? msg.rows : [], msg.type);
      scheduleSync();
      sendResponse({ ok: true, total: mem.pairings.length });
      break;

    case "CLASS_BATCH":
      mem.classes = mergeRows(mem.classes, Array.isArray(msg.rows) ? msg.rows : [], msg.type);
      scheduleSync();
      sendResponse({ ok: true, total: mem.classes.length });
      break;

    case "STAFF_BATCH":
      mem.staff = mergeRows(mem.staff, Array.isArray(msg.rows) ? msg.rows : [], msg.type);
      scheduleSync();
      sendResponse({ ok: true, total: mem.staff.length });
      break;

    case "BULK_PROGRESS":
      mem.bulkDone  = msg.done  ?? mem.bulkDone;
      mem.bulkTotal = msg.total ?? mem.bulkTotal;
      mem.bulkLabel = msg.label ?? mem.bulkLabel;
      scheduleSync();
      sendResponse({ ok: true });
      break;

    case "GET_STATE":
      sendResponse({ ...mem });
      break;

    case "CLEAR":
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = null;
      mem = createDefaultState();
      store.set({ ...mem }, () => {
        const failed = Boolean(chrome.runtime.lastError);
        sendResponse(failed
          ? { ok: false, error: "Could not clear extension storage" }
          : { ok: true });
      });
      break;

    default:
      sendResponse({ ok: false, error: "Unknown message type" });
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  stateReady.then(() => handleMessage(msg || {}, sendResponse));
  // The initial storage restore and CLEAR persistence may respond asynchronously.
  return true;
});
