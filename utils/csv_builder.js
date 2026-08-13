/**
 * csv_builder.js
 *
 * Owns the format-version-1 CSV and JSON file contract shared with the
 * separate Aqua Essence desktop application.
 */

export const STUDENT_HEADERS = [
  "Student ID",
  "Student First Name",
  "Student Last Name",
  "Family",
  "Status",          // required by import_students() — rows without Active are skipped
  "DOB",
  "Age",
  "Current Classes", // registered class name — carried into swimmers.csv
  "Skill Level",
  "Notes",
  "Special Needs",
];

export const PAIRING_HEADERS = [
  "swimmer_id",
  "class_id",
  "instructor_id",
  "class_name",
  "session",
  "status",
];

export const STAFF_HEADERS = [
  "Staff ID",
  "Name",
  "Status",
  "Position",
  "Instructor",
];

export const BUNDLE_FORMAT = "aqua-essence-jackrabbit-export";
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_FILENAME = "aqua_essence_jackrabbit_export.json";

export const BUNDLE_FILE_NAMES = [
  "jackrabbit_students.csv",
  "jackrabbit_classes.csv",
  "jackrabbit_staff.csv",
  "jackrabbit_pairings.csv",
];

// Partner-format classes CSV — matches what import_classes() expects as input,
// plus instructor_id (Jackrabbit staff xID) which import_classes() also reads.
export const CLASS_HEADERS = [
  "Class ID",
  "Class",
  "instructor_id",   // Jackrabbit staff xID — used by DataLoader directly
  "Instructors",     // Human-readable name — kept alongside xID for readability
  "Days",
  "Start Time",
  "End Time",
  "Location",
  "Status",
  "Session",
  "Start Date",
  "End Date",
  "Cat 1",
  "Open",
  "Size",
];

/** Escape a single CSV cell value. */
export function escapeCell(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || /[\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Build a CSV string from headers and an array of row objects. */
export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCell).join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((h) => escapeCell(row[h] ?? "")).join(","));
  });
  return lines.join("\n");
}

/** Deduplicate rows by a composite key function. */
function cleanId(value) {
  return String(value ?? "").trim();
}

export function isNumericXid(value) {
  return /^\d+$/.test(cleanId(value));
}

/** Merge duplicate captures without allowing a later partial row to erase data. */
function mergeByKey(rows, keyFn) {
  const merged = new Map();
  rows.forEach((row, index) => {
    const rawKey = keyFn(row);
    const key = rawKey || `__missing__:${index}`;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, { ...row });
      return;
    }
    for (const [field, value] of Object.entries(row)) {
      if (String(previous[field] ?? "").trim() === "" && String(value ?? "").trim() !== "") {
        previous[field] = value;
      }
    }
  });
  return [...merged.values()];
}

/**
 * Build the students CSV from buffered student records.
 * Deduplicates by first+last+DOB.
 */
export function buildStudentsCsv(students) {
  const deduped = mergeByKey(
    Array.isArray(students) ? students : [],
    (r) =>
      cleanId(r["Student ID"]) ||
      [r["Student First Name"], r["Student Last Name"], r["DOB"]]
        .join("|")
        .toLowerCase()
  );
  return buildCsv(STUDENT_HEADERS, deduped);
}

/**
 * Build the historical pairings CSV from buffered pairing records.
 * Deduplicates by swimmer_id + class_id + session.
 */
export function buildPairingsCsv(pairings) {
  const deduped = mergeByKey(
    Array.isArray(pairings) ? pairings : [],
    (r) => [r.swimmer_id, r.class_id, r.instructor_id, r.session].map(cleanId).join("|")
  );
  return buildCsv(PAIRING_HEADERS, deduped);
}

/**
 * Build the classes CSV from buffered class records.
 * Deduplicates by Class ID (the Jackrabbit xID).
 * Output is in partner format (what import_classes() reads) + instructor_id column.
 */
export function buildClassesCsv(classes) {
  const deduped = mergeByKey(
    Array.isArray(classes) ? classes : [],
    (r) => [r["Class ID"], r.instructor_id].map(cleanId).join("|")
  );
  return buildCsv(CLASS_HEADERS, deduped);
}

/** Build an ActiveStaff-compatible CSV, supplemented from class assignments. */
export function buildStaffCsv(staff = [], classes = []) {
  const rows = (Array.isArray(staff) ? staff : []).map((row) => ({
    "Staff ID": cleanId(row["Staff ID"] || row.staffId),
    "Name": row.Name || [row.firstName, row.lastName].filter(Boolean).join(" "),
    "Status": row.Status || "",
    "Position": row.Position || "Instructor",
    "Instructor": row.Instructor || "1",
  }));

  for (const row of Array.isArray(classes) ? classes : []) {
    const staffId = cleanId(row.instructor_id);
    if (!staffId) continue;
    rows.push({
      "Staff ID": staffId,
      "Name": String(row.Instructors || "").trim(),
      "Status": "",
      "Position": "Instructor",
      "Instructor": "1",
    });
  }

  const deduped = mergeByKey(rows, (row) => cleanId(row["Staff ID"]));
  return buildCsv(STAFF_HEADERS, deduped.filter((row) => row["Staff ID"]));
}

/**
 * Report contract-blocking errors separately from useful incompleteness
 * warnings. The bundle is allowed with warnings, but never with errors.
 */
export function getExportDiagnostics(state = {}) {
  const students = Array.isArray(state.students) ? state.students : [];
  const classes = Array.isArray(state.classes) ? state.classes : [];
  const staff = Array.isArray(state.staff) ? state.staff : [];
  const pairings = Array.isArray(state.pairings) ? state.pairings : [];
  const errors = [];
  const warnings = [];

  if (students.length === 0) errors.push("Capture at least one student before creating a bundle.");
  if (classes.length === 0) errors.push("Capture at least one class before creating a bundle.");

  const invalidStudentIds = students.filter((row) => !isNumericXid(row["Student ID"])).length;
  const invalidClassIds = classes.filter((row) => !isNumericXid(row["Class ID"])).length;
  if (invalidStudentIds > 0) errors.push(`${invalidStudentIds} student row(s) have a missing or non-numeric Student ID.`);
  if (invalidClassIds > 0) errors.push(`${invalidClassIds} class row(s) have a missing or non-numeric Class ID.`);

  const missingStudentNames = students.filter((row) =>
    !String(row["Student First Name"] || "").trim() &&
    !String(row["Student Last Name"] || "").trim()
  ).length;
  const missingStudentStatuses = students.filter((row) =>
    !String(row.Status || "").trim()
  ).length;
  const incompleteClasses = classes.filter((row) =>
    !String(row.Class || "").trim() ||
    !String(row["Start Time"] || "").trim() ||
    !String(row["End Time"] || "").trim()
  ).length;
  const missingInstructorIds = classes.filter((row) =>
    !String(row.instructor_id || "").trim()
  ).length;
  const missingClassStatuses = classes.filter((row) =>
    !String(row.Status || "").trim()
  ).length;
  const invalidInstructorIds = classes.filter((row) =>
    String(row.instructor_id || "").trim() && !isNumericXid(row.instructor_id)
  ).length;
  const invalidStaffIds = staff.filter((row) => !isNumericXid(row["Staff ID"] || row.staffId)).length;
  const missingStaffStatuses = staff.filter((row) => !String(row.Status || "").trim()).length;
  const incompletePairings = pairings.filter((row) =>
    !isNumericXid(row.swimmer_id) || !isNumericXid(row.class_id)
  ).length;

  if (missingStudentNames > 0) warnings.push(`${missingStudentNames} student row(s) have no extracted name.`);
  if (missingStudentStatuses > 0) warnings.push(`${missingStudentStatuses} student row(s) have no extracted status.`);
  if (incompleteClasses > 0) warnings.push(`${incompleteClasses} class row(s) are missing a name or schedule time.`);
  if (missingInstructorIds > 0) warnings.push(`${missingInstructorIds} class row(s) have no extracted instructor ID.`);
  if (missingClassStatuses > 0) warnings.push(`${missingClassStatuses} class row(s) have no extracted status.`);
  if (invalidInstructorIds > 0) warnings.push(`${invalidInstructorIds} class row(s) have a non-numeric instructor ID.`);
  if (invalidStaffIds > 0) warnings.push(`${invalidStaffIds} staff row(s) have a missing or non-numeric Staff ID.`);
  if (missingStaffStatuses > 0) warnings.push(`${missingStaffStatuses} captured staff row(s) have no extracted status.`);
  if (incompletePairings > 0) warnings.push(`${incompletePairings} pairing row(s) have a missing or non-numeric swimmer/class ID.`);
  if (pairings.length === 0) warnings.push("No historical pairings were captured; the pairings CSV will be header-only.");

  return { errors, warnings };
}

/** Build the versioned, single-file handoff consumed by Aqua Essence desktop. */
export function buildAquaEssenceBundle(state = {}, exporterVersion, exportedAt = new Date()) {
  const diagnostics = getExportDiagnostics(state);
  if (diagnostics.errors.length > 0) {
    throw new Error(diagnostics.errors.join(" "));
  }
  const studentsCsv = buildStudentsCsv(state.students || []);
  const classesCsv = buildClassesCsv(state.classes || []);
  const staffCsv = buildStaffCsv(state.staff || [], state.classes || []);
  const pairingsCsv = buildPairingsCsv(state.pairings || []);

  return JSON.stringify({
    format: BUNDLE_FORMAT,
    format_version: BUNDLE_FORMAT_VERSION,
    exported_at: new Date(exportedAt).toISOString(),
    exporter: {
      name: "Jackrabbit Exporter",
      version: String(exporterVersion || "unknown"),
    },
    files: {
      "jackrabbit_students.csv": studentsCsv,
      "jackrabbit_classes.csv": classesCsv,
      "jackrabbit_staff.csv": staffCsv,
      "jackrabbit_pairings.csv": pairingsCsv,
    },
  }, null, 2);
}

/** Trigger a browser file download of the given text content.
 *
 * Uses an anchor-click approach rather than chrome.downloads.download()
 * because blob: URLs are not reliably accepted by the downloads API in
 * Firefox.  The popup has full DOM access so this works in both browsers.
 */
export function downloadText(filename, content, mimeType = "text/csv") {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
