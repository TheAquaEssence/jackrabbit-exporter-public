/**
 * popup.js — extension popup controller
 *
 * Reads buffered state from the background service worker and wires up
 * the download and clear buttons.  During a bulk AllClasses export,
 * polls GET_STATE every 800 ms to show live progress.
 */
import {
  BUNDLE_FILENAME,
  buildAquaEssenceBundle,
  buildClassesCsv,
  buildPairingsCsv,
  buildStaffCsv,
  buildStudentsCsv,
  downloadText,
  getExportDiagnostics,
} from "./utils/csv_builder.js";

const elStudents     = document.getElementById("count-students");
const elPairings     = document.getElementById("count-pairings");
const elClasses      = document.getElementById("count-classes");
const elStaff        = document.getElementById("count-staff");
const elPages        = document.getElementById("count-pages");
const elBulkProg     = document.getElementById("bulk-progress");
const elSessions     = document.getElementById("sessions-section");
const elSessionsList = document.getElementById("sessions-list");
const btnStudents    = document.getElementById("btn-students");
const btnPairings    = document.getElementById("btn-pairings");
const btnClasses     = document.getElementById("btn-classes");
const btnStaff       = document.getElementById("btn-staff");
const btnBundle      = document.getElementById("btn-bundle");
const btnClear       = document.getElementById("btn-clear");
const elStatus       = document.getElementById("status");

let pollInterval = null;

function setStatus(msg, color = "#5f6368") {
  elStatus.textContent = msg;
  elStatus.style.color = color;
}

/** Build the sessions breakdown from buffered pairings. */
function renderSessions(pairings) {
  if (!pairings || pairings.length === 0) {
    elSessions.classList.remove("visible");
    return;
  }

  const counts = {};
  for (const p of pairings) {
    const s = p.session || "(no session)";
    counts[s] = (counts[s] || 0) + 1;
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  elSessionsList.innerHTML = "";
  for (const [session, count] of entries) {
    const row = document.createElement("div");
    row.className = "session-row";
    const label = document.createElement("span");
    label.textContent = session;
    const num = document.createElement("span");
    num.className = "session-count";
    num.textContent = `${count} pairings`;
    row.appendChild(label);
    row.appendChild(num);
    elSessionsList.appendChild(row);
  }

  elSessions.classList.add("visible");
}

function applyState(state) {
  if (!state) return;

  const studentCount = (state.students || []).length;
  const pairingCount = (state.pairings || []).length;
  const classCount   = (state.classes  || []).length;
  const bundledStaffCount = new Set([
    ...(state.staff || []).map((row) => String(row["Staff ID"] || row.staffId || "").trim()),
    ...(state.classes || []).map((row) => String(row.instructor_id || "").trim()),
  ].filter(Boolean)).size;
  const pageCount    = state.pageCount || 0;
  const bulkDone     = state.bulkDone  || 0;
  const bulkTotal    = state.bulkTotal || 0;
  const bulkLabel    = state.bulkLabel || "";

  elStudents.textContent = studentCount;
  elPairings.textContent = pairingCount;
  elClasses.textContent  = classCount;
  elStaff.textContent = bundledStaffCount;
  elPages.textContent    = pageCount;

  btnStudents.disabled = studentCount === 0;
  btnPairings.disabled = pairingCount === 0;
  btnClasses.disabled  = classCount   === 0;
  btnStaff.disabled = bundledStaffCount === 0;
  const diagnostics = getExportDiagnostics(state);
  btnBundle.disabled = diagnostics.errors.length > 0;
  btnBundle.title = diagnostics.errors.join(" ");

  if (diagnostics.errors.length > 0) {
    setStatus(diagnostics.errors[0], "#d93025");
  } else if (diagnostics.warnings.length > 0) {
    const more = diagnostics.warnings.length > 1
      ? ` (+${diagnostics.warnings.length - 1} more)`
      : "";
    setStatus(`Ready with warning: ${diagnostics.warnings[0]}${more}`, "#b06000");
  } else {
    setStatus("Ready to create the Aqua Essence bundle.", "#188038");
  }

  // Bulk progress bar — visible while export is running
  const isBulkRunning = bulkTotal > 0 && bulkDone < bulkTotal;
  if (isBulkRunning) {
    elBulkProg.textContent = bulkLabel || `Fetching… ${bulkDone}/${bulkTotal}`;
    elBulkProg.classList.add("active");
    startPolling();
  } else {
    elBulkProg.classList.remove("active");
    stopPolling();
  }

  renderSessions(state.pairings);
}

function refreshState() {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (chrome.runtime.lastError || !state) {
      setStatus("Could not reach background worker.", "#d93025");
      return;
    }
    applyState(state);
  });
}

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(refreshState, 800);
}

function stopPolling() {
  if (!pollInterval) return;
  clearInterval(pollInterval);
  pollInterval = null;
}

btnStudents.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (!state || !state.students?.length) {
      setStatus("No student data buffered yet.", "#d93025");
      return;
    }
    const csv = buildStudentsCsv(state.students);
    downloadText("jackrabbit_students.csv", csv);
    setStatus(`Downloading ${state.students.length} student records…`, "#1a73e8");
  });
});

btnPairings.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (!state || !state.pairings?.length) {
      setStatus("No pairing data buffered yet.", "#d93025");
      return;
    }
    const csv = buildPairingsCsv(state.pairings);
    downloadText("jackrabbit_pairings.csv", csv);
    setStatus(`Downloading ${state.pairings.length} pairing records…`, "#34a853");
  });
});

btnClasses.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (!state || !state.classes?.length) {
      setStatus("No class data buffered yet.", "#d93025");
      return;
    }
    const csv = buildClassesCsv(state.classes);
    downloadText("jackrabbit_classes.csv", csv);
    setStatus(`Downloading ${state.classes.length} class rows…`, "#fa7b17");
  });
});

btnStaff.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    const csv = buildStaffCsv(state?.staff || [], state?.classes || []);
    downloadText("jackrabbit_staff.csv", csv);
    setStatus("Downloading staff records…", "#5f6368");
  });
});

btnBundle.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
    if (chrome.runtime.lastError || !state) {
      setStatus("Could not reach background worker.", "#d93025");
      return;
    }
    try {
      const bundle = buildAquaEssenceBundle(state, chrome.runtime.getManifest().version);
      downloadText(BUNDLE_FILENAME, bundle, "application/json");
      const warnings = getExportDiagnostics(state).warnings.length;
      setStatus(
        warnings > 0
          ? `Downloading bundle with ${warnings} extraction warning(s)…`
          : "Downloading the Aqua Essence import bundle…",
        warnings > 0 ? "#b06000" : "#673ab7"
      );
    } catch (error) {
      setStatus(error.message || "Bundle validation failed.", "#d93025");
    }
  });
});

btnClear.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "CLEAR" }, (result) => {
    if (chrome.runtime.lastError || !result?.ok) {
      setStatus("Could not clear the export buffer.", "#d93025");
      return;
    }
    stopPolling();
    chrome.runtime.sendMessage({ type: "GET_STATE" }, (state) => {
      if (state) applyState(state);
      setStatus("Buffer cleared.", "#5f6368");
    });
  });
});

// Refresh stats when popup opens
refreshState();
