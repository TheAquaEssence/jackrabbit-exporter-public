import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BUNDLE_FILENAME,
  BUNDLE_FILE_NAMES,
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  CLASS_HEADERS,
  PAIRING_HEADERS,
  STAFF_HEADERS,
  STUDENT_HEADERS,
  buildAquaEssenceBundle,
  buildClassesCsv,
  buildPairingsCsv,
  buildStaffCsv,
  buildStudentsCsv,
  escapeCell,
  getExportDiagnostics,
  isNumericXid,
} from "../utils/csv_builder.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const syntheticState = () => ({
  students: [{
    "Student ID": "000101",
    "Student First Name": "Avery",
    "Student Last Name": "Example",
    Status: "Active",
  }],
  classes: [{
    "Class ID": "000201",
    Class: "Synthetic Tuesday Class",
    instructor_id: "000301",
    Instructors: "Casey Coach",
    "Start Time": "04:00 PM",
    "End Time": "04:30 PM",
  }],
  staff: [],
  pairings: [],
});

test("format-version-1 headers and filenames remain exact", () => {
  assert.deepEqual(STUDENT_HEADERS, [
    "Student ID", "Student First Name", "Student Last Name", "Family", "Status",
    "DOB", "Age", "Current Classes", "Skill Level", "Notes", "Special Needs",
  ]);
  assert.deepEqual(CLASS_HEADERS, [
    "Class ID", "Class", "instructor_id", "Instructors", "Days", "Start Time",
    "End Time", "Location", "Status", "Session", "Start Date", "End Date",
    "Cat 1", "Open", "Size",
  ]);
  assert.deepEqual(STAFF_HEADERS, ["Staff ID", "Name", "Status", "Position", "Instructor"]);
  assert.deepEqual(PAIRING_HEADERS, [
    "swimmer_id", "class_id", "instructor_id", "class_name", "session", "status",
  ]);
  assert.equal(BUNDLE_FILENAME, "aqua_essence_jackrabbit_export.json");
  assert.deepEqual(BUNDLE_FILE_NAMES, [
    "jackrabbit_students.csv",
    "jackrabbit_classes.csv",
    "jackrabbit_staff.csv",
    "jackrabbit_pairings.csv",
  ]);
});

test("CSV escaping handles commas, quotes, CR, and LF", () => {
  assert.equal(escapeCell("plain"), "plain");
  assert.equal(escapeCell("comma, value"), '"comma, value"');
  assert.equal(escapeCell('a "quote"'), '"a ""quote"""');
  assert.equal(escapeCell("line\r\nbreak"), '"line\r\nbreak"');
});

test("student export deduplicates by Student ID and merges partial captures", () => {
  const csv = buildStudentsCsv([
    { "Student ID": "000123", "Student First Name": "Avery", Status: "Active" },
    { "Student ID": "000123", "Student Last Name": "Example", Notes: "Synthetic, \"review\"" },
  ]);

  const lines = csv.split("\n");
  assert.equal(lines[0], STUDENT_HEADERS.join(","));
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^000123,Avery,Example,/);
  assert.match(lines[1], /"Synthetic, ""review"""/);
});

test("class export preserves real xIDs and distinct instructor assignments", () => {
  const csv = buildClassesCsv([
    { "Class ID": "000201", Class: "Synthetic Class", instructor_id: "000301" },
    { "Class ID": "000201", Class: "Synthetic Class", instructor_id: "000302" },
    { "Class ID": "000201", instructor_id: "000301", Session: "Synthetic Session" },
  ]);

  const lines = csv.split("\n");
  assert.equal(lines[0], CLASS_HEADERS.join(","));
  assert.equal(lines.length, 3);
  assert.ok(lines.slice(1).every((line) => line.startsWith("000201,")));
  assert.match(lines[1], /Synthetic Session/);
});

test("pairing export keeps different instructors and removes exact duplicates", () => {
  const base = {
    swimmer_id: "000101",
    class_id: "000201",
    instructor_id: "000301",
    class_name: "Synthetic Class",
    session: "Synthetic Session",
    status: "archived",
  };
  const csv = buildPairingsCsv([
    base,
    { ...base },
    { ...base, instructor_id: "000302" },
  ]);

  assert.equal(csv.split("\n")[0], PAIRING_HEADERS.join(","));
  assert.equal(csv.split("\n").length, 3);
});

test("staff export prefers captured data and supplements numeric class instructor IDs", () => {
  const csv = buildStaffCsv([
    { "Staff ID": "000301", Name: "Casey Coach", Status: "Active", Position: "Instructor", Instructor: "1" },
  ], [
    { instructor_id: "000301", Instructors: "Duplicate Name" },
    { instructor_id: "000302", Instructors: "Morgan Mentor" },
  ]);

  const lines = csv.split("\n");
  assert.equal(lines[0], STAFF_HEADERS.join(","));
  assert.equal(lines.length, 3);
  assert.match(lines[1], /^000301,Casey Coach,/);
  assert.match(lines[2], /^000302,Morgan Mentor,,Instructor,1$/);
});

test("optional staff and pairings payloads may be header-only", () => {
  assert.equal(buildStaffCsv([], []), STAFF_HEADERS.join(","));
  assert.equal(buildPairingsCsv([]), PAIRING_HEADERS.join(","));
});

test("bundle is deterministic at the contract boundary and preserves leading zeroes", () => {
  const exportedAt = "2026-01-02T03:04:05.000Z";
  const bundle = JSON.parse(buildAquaEssenceBundle(syntheticState(), "1.1.0", exportedAt));

  assert.equal(bundle.format, BUNDLE_FORMAT);
  assert.equal(bundle.format_version, BUNDLE_FORMAT_VERSION);
  assert.equal(bundle.exporter.name, "Jackrabbit Exporter");
  assert.equal(bundle.exporter.version, "1.1.0");
  assert.equal(bundle.exported_at, exportedAt);
  assert.deepEqual(Object.keys(bundle.files), BUNDLE_FILE_NAMES);
  assert.match(bundle.files["jackrabbit_students.csv"], /^Student ID,[^\n]+\n000101,/);
  assert.match(bundle.files["jackrabbit_classes.csv"], /^Class ID,[^\n]+\n000201,/);
  assert.equal(bundle.files["jackrabbit_pairings.csv"], PAIRING_HEADERS.join(","));
});

test("bundle generation rejects missing required datasets and invalid required xIDs", () => {
  assert.throws(
    () => buildAquaEssenceBundle({ students: [], classes: [] }, "1.1.0"),
    /Capture at least one student/
  );
  assert.throws(
    () => buildAquaEssenceBundle({
      ...syntheticState(),
      students: [{ "Student ID": "student-101", "Student First Name": "Avery" }],
    }, "1.1.0"),
    /non-numeric Student ID/
  );
  assert.throws(
    () => buildAquaEssenceBundle({
      ...syntheticState(),
      classes: [{ "Class ID": "", Class: "Synthetic Class" }],
    }, "1.1.0"),
    /non-numeric Class ID/
  );
});

test("diagnostics surface incomplete extraction without inventing values", () => {
  const diagnostics = getExportDiagnostics({
    students: [{ "Student ID": "101" }],
    classes: [{ "Class ID": "201", Class: "Synthetic Class" }],
    staff: [{ "Staff ID": "not-an-id" }],
    pairings: [],
  });

  assert.deepEqual(diagnostics.errors, []);
  assert.ok(diagnostics.warnings.some((message) => message.includes("no extracted name")));
  assert.ok(diagnostics.warnings.some((message) => message.includes("schedule time")));
  assert.ok(diagnostics.warnings.some((message) => message.includes("no extracted instructor ID")));
  assert.ok(diagnostics.warnings.some((message) => message.includes("header-only")));
  assert.equal(isNumericXid("000123"), true);
  assert.equal(isNumericXid(123), true);
  assert.equal(isNumericXid("student-123"), false);
});

test("manifest declares reviewed permissions, cross-browser backgrounds, and local assets", async () => {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.minimum_chrome_version, "121");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "121.0");
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://*.jackrabbitclass.com/*",
    "https://*.jackrabbittech.com/*",
  ]);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.background.scripts, ["background.js"]);

  const requiredFiles = [
    manifest.background.service_worker,
    ...manifest.background.scripts,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...Object.values(manifest.icons),
  ];
  for (const file of new Set(requiredFiles)) {
    assert.equal(path.isAbsolute(file), false);
    assert.equal(file.includes(".."), false);
    const contents = await readFile(path.join(projectRoot, file));
    assert.ok(contents.length > 0, `${file} must be a non-empty local asset`);
  }

  const popupHtml = await readFile(path.join(projectRoot, manifest.action.default_popup), "utf8");
  assert.match(popupHtml, /<script type="module" src="popup\.js"><\/script>/);
  await readFile(path.join(projectRoot, "popup.js"));
  await readFile(path.join(projectRoot, "utils", "csv_builder.js"));

  for (const icon of Object.values(manifest.icons)) {
    const bytes = await readFile(path.join(projectRoot, icon));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  }
});

test("content scraper does not synthesize xIDs or log extracted record payloads", async () => {
  const source = await readFile(path.join(projectRoot, "content.js"), "utf8");
  assert.doesNotMatch(source, /xID\s*\*\s*100/);
  assert.doesNotMatch(source, /JSON\.stringify\(firstRow\)/);
  assert.doesNotMatch(source, /classInstructorMap\);/);
  assert.doesNotMatch(source, /from page DOM`, staff/);
  assert.match(source, /"Skill Level":\s+""/);
});

test("content scraper comments use explicit synthetic sample values", async () => {
  const source = await readFile(path.join(projectRoot, "content.js"), "utf8");
  const comments = source
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:\/\/|\*)/.test(line))
    .join("\n");

  assert.doesNotMatch(comments, /["']\d{5,}["']/);
  assert.doesNotMatch(
    comments,
    /\b\d{1,2}\/\d{1,2}\/(?:19|20)\d{2}\b|\b(?:19|20)\d{2}-\d{2}-\d{2}\b/
  );

  const enrollmentBlock = source.match(
    /Column order confirmed via \[AQE\] diagnostic log[\s\S]+?const COLS =/
  );
  assert.ok(enrollmentBlock);
  const enrollmentSamples = enrollmentBlock[0].match(/^\s*\/\/ \[\d+\].*$/gm) || [];
  assert.equal(enrollmentSamples.length, 14);
  for (const sample of enrollmentSamples) {
    assert.match(sample, /<synthetic [^>]+>/);
  }
});
