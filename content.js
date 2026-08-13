/**
 * content.js — Jackrabbit page scraper
 *
 * Page types handled:
 *   /Class/AllClasses    – class list (split-table layout)
 *   /Class/ClassDetail   – one class → enrolled students + instructor from title
 *   /Student/StudentDetail – one student → Past/Current Enrollment tables
 *   /Student/ListStudents – visible filtered student rows
 *   /Staff/ListInstructors and /Staff/StaffDetail – staff + class history
 *
 * Key fix: uses section-heading text ("Current Enrollment", "Past Enrollment")
 * to find the exact table to read, avoiding noise from Jackrabbit's UI tables
 * (tab bars, pagination controls, etc.).
 */

(function () {
  "use strict";

  // -------------------------------------------------------------------------
  // Stop flag — shared across bulk export functions
  // -------------------------------------------------------------------------

  let _stopRequested = false;

  function showStopButton() {
    const btn = document.getElementById("aqe-stop-btn");
    if (!btn) return;
    btn.textContent = "Stop";
    btn.disabled    = false;
    btn.style.display = "";
  }

  function hideStopButton() {
    const btn = document.getElementById("aqe-stop-btn");
    if (btn) btn.style.display = "none";
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  function urlParam(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }

  function clean(s) {
    return String(s || "").trim().replace(/\s+/g, " ");
  }

  function numericXid(value) {
    const id = clean(value);
    return /^\d+$/.test(id) ? id : "";
  }

  /**
   * Look up a cell value by column header name.
   * Tries exact match first, then partial (includes) match.
   */
  function getCell(headers, cells, ...labels) {
    for (const pass of ["exact", "partial"]) {
      for (const label of labels) {
        const idx = headers.findIndex((h) =>
          pass === "exact"
            ? clean(h).toUpperCase() === label.toUpperCase()
            : clean(h).toUpperCase().includes(label.toUpperCase())
        );
        if (idx >= 0 && idx < cells.length && clean(cells[idx])) {
          return clean(cells[idx]);
        }
      }
    }
    return "";
  }

  /**
   * Parse a Jackrabbit class name into its parts.
   *
   * Examples:
   *   "Adult Monday 8:30 pm 2:1 Kenaston"
   *   "RSS 5 Wednesday 8:30 pm 2:1 Kenaston"
   *   "RSS 4 (Saje)/5 (Liam)Wednesday 8:00 pm 2:1 Kenaston"
   *   "(Fill 8pm First) RSS 5 Wednesday 8:30 pm 2:1 Kenaston"
   */
  function parseClassName(name) {
    const n = clean(name);
    const words = n.split(/\s+/);
    const instructorLastName = words[words.length - 1] || "";

    const slotMatch = n.match(
      /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d+:\d+\s*[ap]m)/i
    );
    const classSlot = slotMatch ? `${slotMatch[1]} ${slotMatch[2]}` : "";

    return { instructorLastName, classSlot };
  }

  /**
   * Derive schedule fields from a Jackrabbit class name for when the
   * AllClasses table does not display them (the column layout is
   * user-configurable, so Days / times / Size may be absent from the DOM).
   *
   *   "RSS 5 Wednesday 8:30 pm 2:1 Kenaston"
   *     → { day: "Wed", startTime: "08:30 PM", endTime: "09:00 PM", size: "2" }
   *
   * RSS classes are 30-minute slots, so End Time = Start Time + 30 min.
   */
  function deriveClassSchedule(name) {
    const n = clean(name);

    const dayMatch = n.match(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i
    );
    const day = dayMatch
      ? dayMatch[1][0].toUpperCase() + dayMatch[1].slice(1, 3).toLowerCase()
      : "";

    let startTime = "";
    let endTime   = "";
    const timeMatch = n.match(/(\d{1,2}):(\d{2})\s*([ap]m)\b/i);
    if (timeMatch) {
      const isPm = timeMatch[3].toLowerCase() === "pm";
      const h24  = (parseInt(timeMatch[1], 10) % 12) + (isPm ? 12 : 0);
      const startMinutes = h24 * 60 + parseInt(timeMatch[2], 10);
      const endMinutes   = (startMinutes + 30) % (24 * 60);
      const fmt = (total) => {
        const hh24 = Math.floor(total / 60);
        const mm   = total % 60;
        const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
        const ap   = hh24 >= 12 ? "PM" : "AM";
        return `${String(hh12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ap}`;
      };
      startTime = fmt(startMinutes);
      endTime   = fmt(endMinutes);
    }

    // Class ratio "2:1" / "1:1" → class size (times like "8:30" never match
    // because the digit after the colon must be exactly "1" at a word boundary)
    const ratioMatch = n.match(/\b(\d)\s*:\s*1\b/);
    const size = ratioMatch ? ratioMatch[1] : "";

    return { day, startTime, endTime, size };
  }

  // -------------------------------------------------------------------------
  // Table reading — handles both <thead> and first-row-as-header styles
  // -------------------------------------------------------------------------

  function readTableSmart(tableEl) {
    // Standard: headers in <thead>
    const theadHeaders = [...tableEl.querySelectorAll("thead th, thead td")].map(
      (el) => clean(el.innerText)
    );

    if (theadHeaders.some((h) => h.length > 0)) {
      const rows = [...tableEl.querySelectorAll("tbody tr")]
        .map((tr) =>
          [...tr.querySelectorAll("td")].map((td) => clean(td.innerText))
        )
        .filter((cells) => cells.some((c) => c.length > 0));
      return { headers: theadHeaders, rows };
    }

    // Jackrabbit alternate: first tbody <tr> uses <th> elements for headers
    const allBodyRows = [...tableEl.querySelectorAll("tbody tr")];
    if (allBodyRows.length > 0) {
      const ths = allBodyRows[0].querySelectorAll("th");
      if (ths.length > 0) {
        const headers = [...ths].map((el) => clean(el.innerText));
        const rows = allBodyRows
          .slice(1)
          .map((tr) =>
            [...tr.querySelectorAll("td")].map((td) => clean(td.innerText))
          )
          .filter((cells) => cells.some((c) => c.length > 0));
        return { headers, rows };
      }
    }

    return { headers: [], rows: [] };
  }

  // -------------------------------------------------------------------------
  // jqGrid reader — Jackrabbit uses jqGrid which splits headers and data into
  // two separate <table> elements.  We read column names from aria-describedby
  // and values from the title attribute on each <td>.
  // -------------------------------------------------------------------------

  /**
   * Read a jqGrid.
   * @param {Element} containerEl - Any element that contains the jqGrid
   *   (e.g. the div#CurrEnrollResults wrapper).
   * @returns {Array<Object>|null} Array of plain objects keyed by column name,
   *   or null if no jqGrid btable is found.
   */
  function readJqGrid(containerEl) {
    const btable = containerEl.querySelector("table.ui-jqgrid-btable");
    if (!btable) return null;

    const gridId = btable.id || "";
    const prefix = gridId ? gridId + "_" : null;

    const records = [];
    for (const tr of btable.querySelectorAll("tr.jqgrow")) {
      const record = {};
      for (const td of tr.querySelectorAll("td")) {
        const by  = td.getAttribute("aria-describedby") || "";
        // Strip the grid-id prefix to get the bare column name
        let col = prefix && by.startsWith(prefix)
          ? by.slice(prefix.length)
          : by.includes("_") ? by.slice(by.lastIndexOf("_") + 1) : by;
        if (!col) continue;
        // title attribute holds the clean display value; fall back to innerText
        let val = (td.getAttribute("title") || "").trim();
        if (val === " " || val === " ") val = "";
        if (!val) val = clean(td.innerText);
        record[col] = val;
      }
      if (Object.keys(record).length > 0) records.push(record);
    }
    return records.length > 0 ? records : null;
  }

  /** Case-insensitive column lookup on a jqGrid record object. */
  function getJqCell(record, ...names) {
    for (const name of names) {
      const key = Object.keys(record).find(
        (k) => k.toUpperCase() === name.toUpperCase()
      );
      if (key && record[key]) return record[key];
    }
    return "";
  }

  /**
   * Like readJqGrid but safe for DOMParser output — uses textContent instead
   * of innerText as the fallback (parsed documents have no layout engine).
   * The title attribute (primary source) works identically on both.
   */
  function readJqGridDoc(containerEl) {
    const btable = containerEl.querySelector("table.ui-jqgrid-btable");
    if (!btable) return null;

    const gridId = btable.id || "";
    const prefix = gridId ? gridId + "_" : null;

    const records = [];
    for (const tr of btable.querySelectorAll("tr.jqgrow")) {
      const record = {};
      for (const td of tr.querySelectorAll("td")) {
        const by  = td.getAttribute("aria-describedby") || "";
        let col = prefix && by.startsWith(prefix)
          ? by.slice(prefix.length)
          : by.includes("_") ? by.slice(by.lastIndexOf("_") + 1) : by;
        if (!col) continue;
        let val = (td.getAttribute("title") || "").trim();
        if (val === " " || val === " ") val = "";
        if (!val) val = clean(td.textContent); // textContent works on parsed DOM
        record[col] = val;
      }
      if (Object.keys(record).length > 0) records.push(record);
    }
    return records.length > 0 ? records : null;
  }

  // -------------------------------------------------------------------------
  // Bulk fetch helpers — used by scrapeAllClassesBulk()
  // -------------------------------------------------------------------------

  const FETCH_DELAY_MS  = 100; // pause between concurrent batches
  const FETCH_CONCURRENCY = 5; // max simultaneous requests

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Run an array of async task functions with bounded concurrency.
   * Results are returned in the same order as tasks.
   * @param {Array<() => Promise<T>>} tasks
   * @param {number} limit
   * @returns {Promise<T[]>}
   */
  async function runConcurrent(tasks, limit) {
    const results = new Array(tasks.length);
    let next = 0;
    async function worker() {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, tasks.length) }, worker)
    );
    return results;
  }

  /**
   * Fetch the AllStaff jqGrid and return a map of { lastNameLower -> staffXID }.
   * Used at the start of bulk export to resolve instructor names to staff IDs.
   * Returns an empty map on any error so the export continues without staff IDs.
   */
  async function fetchStaffMap(host) {
    // Step 1: fetch the ListInstructors page HTML to find the grid data URL
    let html = "";
    try {
      const res = await fetch(`https://${host}/jr4.0/Staff/ListInstructors?active=True`, { credentials: "include" });
      if (!res.ok) return {};
      html = await res.text();
    } catch { return {}; }

    // Step 2: find the GridDataRequested URL in inline scripts
    let dataUrl = null;
    const urlMatch = html.match(/url:\s*['"`]([^'"`]*GridDataRequested[^'"`]*)['"` ]/);
    if (urlMatch) {
      dataUrl = urlMatch[1];
      if (!dataUrl.startsWith("http")) dataUrl = `https://${host}${dataUrl}`;
      dataUrl = dataUrl.replace(/([?&])rows=\d+/, "$1rows=1000");
      if (!dataUrl.includes("rows=")) dataUrl += "&rows=1000&page=1";
    } else {
      // Canonical fallback
      dataUrl = `https://${host}/jr4.0/Staff/ListInstructorsGridDataRequested`
        + `?active=True&jqGridID=NOCOOKIE_ListInstructorsJQGrid&rows=1000&page=1&sidx=&sord=asc`;
    }

    // Step 3: fetch the grid data and build the name→ID map
    let data;
    try {
      const res = await fetch(dataUrl, { credentials: "include" });
      if (!res.ok) {
        console.warn("[AQE] Staff map request failed with HTTP", res.status);
        return {};
      }
      data = await res.json();
    } catch { return {}; }

    const COLS = ["StaffId", "Col1", "Col2", "LastName", "FirstName", "Col5",
                  "Col6", "Col7", "Col8", "Col9", "Col10", "Col11", "Col12",
                  "Col13", "Col14", "Col15", "Col16", "Col17"];
    const rows = parseJqGridJson(data, COLS);
    if (rows.length === 0) {
      console.warn("[AQE] Staff map returned no rows");
      return {};
    }

    const map = {};
    for (const r of rows) {
      const id        = numericXid(getJqCell(r, "StaffId"));
      const firstName = getJqCell(r, "FirstName");
      const lastName  = getJqCell(r, "LastName");
      const fullName  = [firstName, lastName].filter(Boolean).join(" ");
      if (!id || !fullName) continue;
      // Index by full name, first name, and last name (all lowercased, punctuation stripped).
      // Handles both "<synthetic first name> <synthetic last name>" and "<synthetic last name>, <synthetic first name>" display formats.
      const rawWords = fullName.trim().split(/\s+/)
        .map((w) => w.replace(/\W+$/, "").toLowerCase());
      const words = rawWords.filter((w) => w.length > 1); // significant words only
      const full = words.join(" ");
      if (full)                      map[full]                      = id;
      if (words[0])                  map[words[0]]                  = id;
      if (words.length > 1)          map[words[words.length - 1]]   = id;
      // Also index "<synthetic first name> <synthetic last initial>" to match Jackrabbit's
      // truncated enrollment display format, which is more specific than first name alone.
      if (rawWords.length > 1 && rawWords[1].length === 1) {
        map[`${rawWords[0]} ${rawWords[1]}`] = id;
      } else if (words.length > 1) {
        map[`${words[0]} ${words[1][0]}`] = id;
      }
    }
    console.log(`[AQE] Staff map built: ${Object.keys(map).length} entries`);
    return map;
  }

  /**
   * Parse a jqGrid JSON response into an array of record objects.
   * jqGrid can return rows in two formats:
   *   1. Named properties: { "Class": "...", "Session": "..." }
   *   2. Cell array:       { "id": "...", "cell": ["val1", "val2", ...] }
   * @param {Object} data   Parsed JSON response
   * @param {string[]} cols Column names in order (used for cell-array format)
   */
  function parseJqGridJson(data, cols) {
    const rows = data.rows || data.Rows || [];
    return rows.map((row) => {
      if (Array.isArray(row.cell)) {
        return Object.fromEntries(cols.map((c, i) => [c, String(row.cell[i] ?? "")]));
      }
      // Named-property format — just normalise values to strings
      const rec = {};
      for (const [k, v] of Object.entries(row)) {
        rec[k] = v == null ? "" : String(v);
      }
      return rec;
    });
  }

  /**
   * Fetch a ClassDetail page and extract the instructor staff xIDs only.
   * Lighter than fetchClassStudentIds — does NOT fetch the enrollment jqGrid.
   *
   * @returns {string[]} Array of staff xID strings (may be empty on error)
   */
  async function fetchClassInstructorIds(host, xID) {
    const pageUrl = `https://${host}/jr4.0/Class/ClassDetail?xID=${xID}`;
    let html;
    try {
      const res = await fetch(pageUrl, { credentials: "include" });
      if (!res.ok) return [];
      html = await res.text();
    } catch {
      return [];
    }
    const doc = new DOMParser().parseFromString(html, "text/html");
    const primaryTeacherId = doc.getElementById("PrimaryTeacherID")?.value?.trim() || "";
    const teacher2Id       = doc.getElementById("Teacher2ID")?.value?.trim()       || "";
    const teacher3Id       = doc.getElementById("Teacher3ID")?.value?.trim()       || "";
    const teacher4Id       = doc.getElementById("Teacher4ID")?.value?.trim()       || "";
    return [primaryTeacherId, teacher2Id, teacher3Id, teacher4Id]
      .map(numericXid).filter(Boolean);
  }

  /**
   * Fetch a ClassDetail page, extract the jqGrid data endpoint from its inline
   * script, call that endpoint for JSON, and return enrolled student IDs.
   *
   * @returns {{ classId, instructorLastName, studentIds,
   *             studentNames }} or null on error
   */
  async function fetchClassStudentIds(host, xID) {
    const pageUrl = `https://${host}/jr4.0/Class/ClassDetail?xID=${xID}`;
    let html;
    try {
      const res = await fetch(pageUrl, { credentials: "include" });
      if (!res.ok) return null;
      html = await res.text();
    } catch {
      return null;
    }

    // Class metadata from title text in the fetched HTML
    const doc = new DOMParser().parseFromString(html, "text/html");
    const h1 = doc.querySelector("h1, h2, h3");
    const rawTitle = h1
      ? clean(h1.textContent).replace(/^Class:\s*/i, "")
      : "";
    const { instructorLastName } = parseClassName(rawTitle);

    // Extract instructor staff xIDs directly from the hidden <select> elements
    // that Jackrabbit embeds in the ClassDetail HTML form.
    // PrimaryTeacherID holds the main instructor; Teacher2-4 cover co-instructors.
    const primaryTeacherId = doc.getElementById("PrimaryTeacherID")?.value?.trim() || "";
    const teacher2Id       = doc.getElementById("Teacher2ID")?.value?.trim()       || "";
    const teacher3Id       = doc.getElementById("Teacher3ID")?.value?.trim()       || "";
    const teacher4Id       = doc.getElementById("Teacher4ID")?.value?.trim()       || "";
    // Collect all non-empty teacher IDs in order
    const instructorIds = [primaryTeacherId, teacher2Id, teacher3Id, teacher4Id]
      .map(numericXid).filter(Boolean);

    // ---- Enrollment jqGrid URL ----
    let dataUrl = null;
    const urlMatch = html.match(/url:\s*['"`]([^'"`]*(Enrollment|Enroll)[^'"`]*GridDataRequested[^'"`]*)['"` ]/i);
    if (urlMatch) {
      dataUrl = urlMatch[1];
      if (!dataUrl.startsWith("http")) dataUrl = `https://${host}${dataUrl}`;
    }
    if (!dataUrl) {
      dataUrl = `https://${host}/jr4.0/Class/ClassDetailEnrollmentsGridDataRequested`
        + `?xID=${xID}&isMasterClass=False`
        + `&jqGridID=NOCOOKIE_ClassDetailEnrollmentJQGrid`
        + `&rows=1000&page=1&sidx=&sord=asc`;
    } else {
      dataUrl = dataUrl.replace(/([?&])rows=\d+/, "$1rows=1000");
      if (!dataUrl.includes("rows=")) dataUrl += "&rows=1000&page=1";
    }

    // Fetch enrollment data
    const enrollData = await fetch(dataUrl, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    // ---- Parse enrollment rows ----
    const empty = { classId: xID, instructorLastName, instructorIds, studentIds: [], studentNames: {} };
    if (!enrollData) return empty;

    // Column order confirmed via [AQE] diagnostic log (cell-array format):
    // [0]  "<synthetic enrollment record xID>"  → Id (enrollment record ID)
    // [1]  "<synthetic student xID>"           → StudentId (student xID — used in URLs)
    // [2]  "<synthetic class xID>"             → ClassId (class xID)
    // [3]  "<synthetic enrollment date>"       → EnrollDate
    // [4]  "<synthetic session start date>"    → SessionStart
    // [5]  "<synthetic session end date>"      → SessionEnd
    // [6]  "<synthetic coordinator xID>"       → EnrollUserID (numeric coordinator ID)
    // [7]  "<synthetic coordinator last name>" → EnrollUserLast (coordinator last name)
    // [8]  "<synthetic enrollment reason>"     → EnrollReason
    // [9]  "<synthetic student name>"          → StudentName (full name) ← KEY FIELD
    // [10] "<synthetic gender value>"          → Gender
    // [11] "<synthetic age display>"           → AgeWithMonths
    // [12] "<synthetic birth date>"            → BirthDate
    // [13] "<synthetic drop note>"             → DropNotes
    const COLS = [
      "Id",            "StudentId",    "ClassId",       "EnrollDate",
      "SessionStart",  "SessionEnd",   "EnrollUserID",  "EnrollUserLast",
      "EnrollReason",  "StudentName",  "Gender",        "AgeWithMonths",
      "BirthDate",     "DropNotes",
    ];
    const rows = parseJqGridJson(enrollData, COLS);

    const studentIds = [];
    const studentNames = {};
    for (const r of rows) {
      const sid  = numericXid(getJqCell(r, "StudentId", "StudentID"));
      const name = getJqCell(r, "StudentName");
      if (sid) {
        studentIds.push(sid);
        studentNames[sid] = name || "";
      }
    }

    return { classId: xID, instructorLastName, instructorIds, studentIds, studentNames };
  }

  /**
   * Call the jqGrid JSON endpoint for a student's Past Enrollment directly,
   * bypassing HTML parsing (jqGrid data is AJAX-loaded, not server-rendered).
   *
   * Endpoint discovered via Network tab:
   *   GET /jr4.0/Student/StudentDetailClassesPastEnrollsGridDataRequested
   *     ?xID={swimmerId}&jqGridID=NOCOOKIE_StudentDetailClassesPastEnrollJQGrid
   *     &rows=1000&page=1&sidx=&sord=asc
   *
   * @returns {Array<Object>} pairing rows (may be empty)
   */
  async function fetchStudentPastEnrollment(host, swimmerId, staffMap = {}) {
    const GRID_ID = "NOCOOKIE_StudentDetailClassesPastEnrollJQGrid";
    const apiUrl = `https://${host}/jr4.0/Student/StudentDetailClassesPastEnrollsGridDataRequested`
      + `?xID=${swimmerId}&jqGridID=${GRID_ID}&rows=1000&page=1&sidx=&sord=asc`;

    let data;
    try {
      const res = await fetch(apiUrl, { credentials: "include" });
      if (!res.ok) return [];
      data = await res.json();
    } catch {
      return [];
    }

    // Column order for cell-array format (confirmed via Network tab inspection)
    const COLS = ["ClassID", "Class", "Session", "Instructors", "EnrollDate",
                  "EnrollUserID", "EnrollReason", "DropDate", "DropReason",
                  "DropUserID", "Completed", "DropNotes"];
    const rows = parseJqGridJson(data, COLS);

    return rows
      .map((rec) => {
        const className   = getJqCell(rec, "Class");
        const session     = getJqCell(rec, "Session");
        const instructors = getJqCell(rec, "Instructors");
        const classId     = numericXid(getJqCell(rec, "ClassID"));
        if (!className && !instructors) return null;
        // Look up staff ID from the Instructors field (for example, "<synthetic instructor display name>").
        // Lookup order: full name → first+initial → last name → first name.
        let instructor_id = "";
        if (instructors && Object.keys(staffMap).length > 0) {
          const rawWords = instructors.trim().split(/\s+/)
            .map((w) => w.replace(/\W+$/, "").toLowerCase());
          const words = rawWords.filter((w) => w.length > 1);
          const full = words.join(" ");
          const firstInitial = rawWords.length > 1
            ? `${rawWords[0]} ${rawWords[1][0]}`
            : "";
          instructor_id = staffMap[full]
            || (firstInitial && staffMap[firstInitial])
            || staffMap[words[words.length - 1]]
            || staffMap[words[0]]
            || "";
        }

        return {
          swimmer_id:         swimmerId,
          class_id:           classId || "",
          instructor_id,
          class_name:         className,
          session,
          status:             "archived",
        };
      })
      .filter(Boolean);
  }

  // -------------------------------------------------------------------------
  // /Staff/ListInstructors — Staff History bulk export helpers
  // -------------------------------------------------------------------------

  /**
   * Read the staff list from the DOM already rendered on the page.
   * Respects whatever filter the user has applied — only returns visible rows.
   *
   * Tries four strategies in order, logs diagnostics to console.
   * Returns [{ staffId, firstName, lastName }].
   */
  function readStaffFromPageDom() {
    const staff = [];
    const seen  = new Set();

    // A detail page has one authoritative staff xID in its URL. Avoid scanning
    // navigation links that may point at unrelated staff records.
    if (location.pathname.toLowerCase().includes("/staff/staffdetail")) {
      const staffId = numericXid(urlParam("xID"));
      if (!staffId) return [];
      const firstName = clean(document.querySelector(
        "#FirstName, input[name='FirstName'], input[id*='irstName']"
      )?.value);
      const lastName = clean(document.querySelector(
        "#LastName, input[name='LastName'], input[id*='astName']"
      )?.value);
      const heading = clean(document.querySelector("h1, h2")?.innerText)
        .replace(/^Staff:\s*/i, "");
      const status = clean(
        document.querySelector("#StaffStatus, #Status")?.value ||
        document.querySelector("#StaffStatus option:checked, #Status option:checked")?.textContent
      );
      return [{
        staffId,
        firstName,
        lastName: lastName || (!firstName ? heading : ""),
        status,
      }];
    }

    // Diagnostics — check what's actually on the page
    console.log("[AQE] readStaffFromPageDom diagnostics:");
    console.log("  table.ui-jqgrid-btable:", document.querySelectorAll("table.ui-jqgrid-btable").length);
    console.log("  tr.jqgrow:", document.querySelectorAll("tr.jqgrow").length);
    console.log("  a[href*=StaffDetail]:", document.querySelectorAll("a[href*='StaffDetail']").length);
    console.log("  tbody tr:", document.querySelectorAll("tbody tr").length);

    function addStaff(staffId, nameText, statusText = "") {
      staffId = numericXid(staffId);
      if (!staffId || seen.has(staffId)) return;
      seen.add(staffId);
      // Jackrabbit may show "<synthetic last name>, <synthetic first name>" or "<synthetic last name>".
      const commaSplit = nameText.split(/\s*,\s*/);
      const firstName  = commaSplit.length > 1 ? commaSplit[1].trim() : "";
      const lastName   = commaSplit[0].trim();
      staff.push({ staffId, firstName, lastName, status: clean(statusText) });
    }

    // Strategy 1 — jqGrid via readJqGrid() (uses aria-describedby column names)
    for (const btable of document.querySelectorAll("table.ui-jqgrid-btable")) {
      const container = btable.closest(".ui-jqgrid") || btable.parentElement;
      const rows = readJqGrid(container);
      if (!rows || rows.length === 0) continue;
      console.log(`[AQE] S1: jqGrid btable has ${rows.length} rows, sample keys:`, Object.keys(rows[0]));
      for (const rec of rows) {
        const staffId = getJqCell(rec, "StaffId", "StaffID", "xID", "Id");
        const nameText = [getJqCell(rec, "LastName", "Last"), getJqCell(rec, "FirstName", "First")]
          .filter(Boolean).join(", ");
        addStaff(
          staffId,
          nameText || getJqCell(rec, "Name") || "",
          getJqCell(rec, "Status")
        );
      }
      if (staff.length > 0) { console.log(`[AQE] S1 found ${staff.length}`); return staff; }
    }

    // Strategy 2 — StaffDetail anchor hrefs anywhere on the page
    for (const anchor of document.querySelectorAll("a")) {
      if (!/StaffDetail/i.test(anchor.href)) continue;
      const match = anchor.href.match(/[?&]xID=(\d+)/i);
      if (!match) continue;
      const status = [...(anchor.closest("tr")?.querySelectorAll("td") || [])]
        .map((td) => clean(td.innerText)).find((text) => /^(active|inactive)$/i.test(text)) || "";
      addStaff(match[1], clean(anchor.innerText), status);
    }
    if (staff.length > 0) { console.log(`[AQE] S2 found ${staff.length}`); return staff; }

    // Strategy 3 — any tbody row that contains a StaffDetail link
    for (const tr of document.querySelectorAll("tbody tr")) {
      const anchor = [...tr.querySelectorAll("a")].find((a) => /StaffDetail/i.test(a.href));
      if (!anchor) continue;
      const match = anchor.href.match(/[?&]xID=(\d+)/i);
      if (!match) continue;
      const cellText = [...tr.querySelectorAll("td")]
        .map((td) => clean(td.innerText)).filter(Boolean).join(" ");
      const status = [...tr.querySelectorAll("td")]
        .map((td) => clean(td.innerText)).find((text) => /^(active|inactive)$/i.test(text)) || "";
      addStaff(match[1], clean(anchor.innerText) || cellText, status);
    }
    if (staff.length > 0) { console.log(`[AQE] S3 found ${staff.length}`); return staff; }

    // Strategy 4 — tr.jqgrow rows (in case jqGrid is present but no btable class match)
    for (const tr of document.querySelectorAll("tr.jqgrow")) {
      // xID from row id attribute (jqGrid sets id="<rowid>" on tr.jqgrow)
      const rowId = tr.getAttribute("id") || "";
      const cells = [...tr.querySelectorAll("td")];
      // Also check anchors
      const anchor = cells.flatMap((td) => [...td.querySelectorAll("a")])
        .find((a) => /StaffDetail/i.test(a.href) || /[?&]xID=/i.test(a.href));
      const xidMatch = anchor?.href.match(/[?&]xID=(\d+)/i);
      const staffId  = xidMatch ? xidMatch[1] : (/^\d+$/.test(rowId) ? rowId : "");
      if (!staffId) continue;
      const nameText = anchor ? clean(anchor.innerText) :
        cells.map((td) => clean(td.innerText)).find(Boolean) || "";
      const status = cells.map((td) => clean(td.innerText))
        .find((text) => /^(active|inactive)$/i.test(text)) || "";
      addStaff(staffId, nameText, status);
    }
    if (staff.length > 0) { console.log(`[AQE] S4 found ${staff.length}`); return staff; }

    console.warn("[AQE] readStaffFromPageDom: all strategies failed");
    return [];
  }

  /**
   * Fetch full class history for one instructor (Active + Archived + Cancelled).
   * Returns [{ classId, className, session, isArchived }].
   *
   * Endpoint: /jr4.0/Staff/InstructorClassHistoryGridDataRequested
   *   ?xID={staffId}&rows=2000&page=1
   */
  async function fetchInstructorClassHistory(host, staffId) {
    const url = `https://${host}/jr4.0/Staff/InstructorClassHistoryGridDataRequested`
      + `?xID=${staffId}&jqGridID=NOCOOKIE_InstructorClassHistoryJQGrid`
      + `&rows=2000&page=1&sidx=&sord=asc`;
    let data;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      data = await res.json();
    } catch { return []; }

    // Column order confirmed via live diagnostic logging:
    // [0] ClassId  [1] LocationAbbr  [2] ClassName  [3] Session  [4] Status
    // [5] Enrolled [6] Open          [7] LocationFull [8] StartDate [9] EndDate
    // [10] Days    [11] StartEndTime
    const COLS = ["ClassId", "LocationAbbr", "ClassName", "Session", "Status",
                  "Enrolled", "Open", "LocationFull", "StartDate", "EndDate",
                  "Days", "StartEndTime"];
    const rows = parseJqGridJson(data, COLS);

    return rows.map((r) => {
      const classId   = numericXid(getJqCell(r, "ClassId", "xID", "Id"));
      const className = getJqCell(r, "ClassName", "Class", "Name");
      const session   = getJqCell(r, "Session");
      const status    = getJqCell(r, "Status");
      if (!classId) return null;
      // Jackrabbit status values: "Active", "Archived", "Cancelled"
      const isArchived = /archiv/i.test(status);
      const isCancelled = /cancel/i.test(status);
      return { classId, className, session, isArchived, isCancelled };
    }).filter(Boolean);
  }

  /**
   * For an archived class: fetch students from the Drop List tab.
   * When Jackrabbit archives a class it bulk-moves all enrolled students to the
   * Drop List with drop_reason = "Class Archived".
   * Returns [{ studentId, studentName }].
   *
   * Endpoint: /jr4.0/Class/ClassDetailDropListGridDataRequested
   *   ?xID={classId}&rows=1000&page=1
   *
   * Cell layout (confirmed via session exploration):
   *   [0] = record Id, [1] = StudentId, [2] = StudentName, ..., [?] = DropReason
   */
  async function fetchDropListStudents(host, classId) {
    const url = `https://${host}/jr4.0/Class/ClassDetailDropListGridDataRequested`
      + `?xID=${classId}&jqGridID=NOCOOKIE_ClassDetailDropListJQGrid`
      + `&rows=1000&page=1&sidx=&sord=asc`;
    let data;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        console.warn("[AQE] Drop-list request failed with HTTP", res.status);
        return [];
      }
      data = await res.json();
    } catch {
      console.warn("[AQE] Drop-list request failed");
      return [];
    }

    const rawRows = data.rows || data.Rows || [];
    if (rawRows.length === 0) return [];

    const COLS = ["Id", "StudentId", "StudentName", "EnrollDate", "DropDate",
                  "DropReason", "DropUserID", "DropNotes", "Col9"];
    const rows = parseJqGridJson(data, COLS);

    // We only call this for archived classes, so accept all rows regardless of
    // drop reason — no need to filter by "Class Archived".
    return rows
      .map((r) => ({
        studentId:   numericXid(getJqCell(r, "StudentId", "StudentID")),
        studentName: getJqCell(r, "StudentName"),
      }))
      .filter((r) => r.studentId);
  }

  // -------------------------------------------------------------------------
  // /Staff/ListInstructors — main bulk export orchestrator
  // -------------------------------------------------------------------------

  /**
   * Bulk historical pairings export via the Staff page.
   *
   * Approach:
   *  1. Fetch all active staff xIDs
   *  2. Per instructor: fetch full class history (all sessions, Active + Archived)
   *  3. Per archived class: fetch students from Drop List → emit PAIRING_BATCH
   *     with instructor_id = staff xID (no name-lookup needed)
   *  4. Skip Active and Cancelled classes (not historical)
   *
   * Advantage over AllClasses approach: produces pairings across ALL past sessions
   * in one click, not just the session currently shown on the AllClasses page.
   */
  async function scrapeStaffHistoryBulk() {
    const btn  = document.getElementById("aqe-export-btn");
    const host = location.hostname;

    _stopRequested   = false;
    showStopButton();

    // Step 1 — read the filtered staff list from the page DOM
    if (btn) btn.textContent = "Reading staff list…";
    const staff = readStaffFromPageDom();
    if (staff.length === 0) {
      hideStopButton();
      showFeedback("No instructors found on this page — apply a filter or navigate to Staff list", false);
      return;
    }
    chrome.runtime.sendMessage({
      type: "STAFF_BATCH",
      rows: staff.map(({ staffId, firstName, lastName, status }) => ({
        "Staff ID": staffId,
        "Name": [firstName, lastName].filter(Boolean).join(" "),
        "Status": status,
        "Position": "Instructor",
        "Instructor": "1",
      })),
    });
    console.log(`[AQE] Staff History: ${staff.length} instructor(s) found`);

    // Phase 1 — fetch all class histories in parallel
    if (btn) btn.textContent = `Fetching history for ${staff.length} instructor(s)…`;
    const historyTasks = staff.map(({ staffId }) =>
      () => fetchInstructorClassHistory(host, staffId)
    );
    const allHistories = await runConcurrent(historyTasks, FETCH_CONCURRENCY);

    if (_stopRequested) { hideStopButton(); showFeedback("Stopped", false); return; }

    // Summarise what we found
    staff.forEach((_staffRow, i) => {
      const total    = allHistories[i].length;
      const active   = allHistories[i].filter((c) => !c.isArchived && !c.isCancelled).length;
      const archived = allHistories[i].filter((c) => c.isArchived).length;
      console.log(`[AQE] Instructor ${i + 1}: ${total} total, ${active} active, ${archived} archived classes`);
    });

    // Phase 2 — per instructor, fetch students via the correct endpoint:
    //   Active class   → Enroll List (ClassDetailEnrollmentsGridDataRequested)
    //   Archived class → Drop List   (ClassDetailDropListGridDataRequested)
    //   Cancelled      → skip
    let totalPairings   = 0;
    let skippedClasses  = 0;
    let instructorsDone = 0;

    for (let si = 0; si < staff.length; si++) {
      if (_stopRequested) break;

      const { staffId, firstName, lastName } = staff[si];
      const classes = allHistories[si].filter((c) => !c.isCancelled);

      if (classes.length === 0) { instructorsDone = si + 1; continue; }

      // One async task per class, routed by status
      const tasks = classes.map(({ classId, className, session, isArchived }) =>
        async () => {
          let students;
          if (isArchived) {
            // Archived: students moved to Drop List when class was archived
            students = await fetchDropListStudents(host, classId);
          } else {
            // Active: students still in Enroll List
            const classData = await fetchClassStudentIds(host, classId);
            students = (classData?.studentIds || []).map((sid) => ({
              studentId:   sid,
              studentName: classData.studentNames?.[sid] || "",
            }));
          }
          return { classId, className, session, isArchived, students };
        }
      );

      // Process in concurrent batches
      for (let bi = 0; bi < tasks.length; bi += FETCH_CONCURRENCY) {
        if (_stopRequested) break;

        const batchEnd = Math.min(bi + FETCH_CONCURRENCY, tasks.length);
        if (btn) {
          btn.textContent =
            `Instr ${si + 1}/${staff.length} (${lastName}) — ` +
            `Class ${bi + 1}–${batchEnd}/${tasks.length}`;
        }
        chrome.runtime.sendMessage({
          type:  "BULK_PROGRESS",
          done:  si * 1000 + bi,
          total: staff.length * 1000,
          label: `${lastName}: classes ${bi + 1}–${batchEnd}/${tasks.length}`,
        });

        const batchResults = await Promise.all(tasks.slice(bi, batchEnd).map((t) => t()));

        for (const { classId, className, session, isArchived, students } of batchResults) {
          if (students.length === 0) { skippedClasses++; continue; }
          const pairingRows = students.map(({ studentId }) => ({
            swimmer_id:    studentId,
            class_id:      classId,
            instructor_id: staffId,
            class_name:    className,
            session,
            status:        isArchived ? "archived" : "active",
          }));
          chrome.runtime.sendMessage({ type: "PAIRING_BATCH", rows: pairingRows });
          totalPairings += pairingRows.length;
        }

        if (bi + FETCH_CONCURRENCY < tasks.length) await sleep(FETCH_DELAY_MS);
      }

      instructorsDone = si + 1;
    }

    hideStopButton();
    const stopped = _stopRequested;
    chrome.runtime.sendMessage({
      type: "BULK_PROGRESS",
      done: staff.length * 1000,
      total: staff.length * 1000,
      label: stopped ? "Stopped" : "Complete",
    });
    showFeedback(
      stopped
        ? `Stopped — ${totalPairings} pairings from ${instructorsDone}/${staff.length} instructors`
        : `Done — ${totalPairings} pairings from ${staff.length} instructors` +
          (skippedClasses > 0 ? ` (${skippedClasses} empty classes skipped)` : "")
    );
  }

  // -------------------------------------------------------------------------
  // Find a table by the section heading above it
  // -------------------------------------------------------------------------

  /**
   * Walk the DOM looking for an element whose visible text exactly matches
   * headingText, then find the first <table> that follows it.
   */
  /**
   * Find the data table associated with a section heading.
   *
   * Strategy A (Jackrabbit-specific): look for <span class="hdg"> whose text
   * matches, then search inside its parent <div class="divCont"> for a table,
   * and fall back to siblings of that div.
   *
   * Strategy B (generic): walk every candidate element by text, then walk DOM
   * siblings/ancestors for the next <table>.
   */
  function findTableNearHeading(headingText) {
    const needle = headingText.toUpperCase();

    // ---- Strategy A: Jackrabbit span.hdg / div.divCont pattern ----
    // Two passes so we always prefer the divCont that directly holds the table
    // (Jackrabbit duplicates headings for tab navigation — the tab heading has
    // no table inside, the content pane heading does).

    // Pass A-1: divCont that directly contains the data table
    for (const span of document.querySelectorAll("span.hdg")) {
      if (clean(span.innerText).toUpperCase() !== needle) continue;
      const container = span.closest("div");
      if (!container) continue;
      const t = container.querySelector("table");
      if (t) return t;
    }
    // Pass A-2: divCont with no table — look at following siblings
    for (const span of document.querySelectorAll("span.hdg")) {
      if (clean(span.innerText).toUpperCase() !== needle) continue;
      const container = span.closest("div");
      if (!container) continue;
      let sib = container.nextElementSibling;
      while (sib) {
        if (sib.tagName === "TABLE") return sib;
        const inner = sib.querySelector("table");
        if (inner) return inner;
        sib = sib.nextElementSibling;
      }
    }

    // ---- Strategy B: generic DOM walk ----
    // Collect ancestor tables for a given element so we never return them.
    function ancestorTableSet(el) {
      const s = new Set();
      let n = el.parentElement;
      while (n && n !== document.body) {
        if (n.tagName === "TABLE") s.add(n);
        n = n.parentElement;
      }
      return s;
    }

    function walkForTable(el) {
      const ancestors = ancestorTableSet(el);
      let node = el;
      for (let depth = 0; depth < 10; depth++) {
        if (!node || node === document.body) break;
        let sib = node.nextElementSibling;
        while (sib) {
          if (sib.tagName === "TABLE" && !ancestors.has(sib)) return sib;
          const inner = sib.querySelector("table");
          if (inner && !ancestors.has(inner)) return inner;
          sib = sib.nextElementSibling;
        }
        node = node.parentElement;
      }
      return null;
    }

    const tags = "td,th,div,span,p,h1,h2,h3,h4,b,strong,label,li";
    const candidates = [...document.querySelectorAll(tags)];

    // exact match
    for (const el of candidates) {
      if (clean(el.innerText).toUpperCase() === needle) {
        const t = walkForTable(el);
        if (t) return t;
      }
    }
    // starts-with (for example, "STUDENT: <synthetic student name>")
    for (const el of candidates) {
      if (clean(el.innerText).toUpperCase().startsWith(needle)) {
        const t = walkForTable(el);
        if (t) return t;
      }
    }
    // contains — leaf-ish elements only (≤ 60 chars)
    for (const el of candidates) {
      const txt = clean(el.innerText);
      if (txt.length <= 60 && txt.toUpperCase().includes(needle)) {
        const t = walkForTable(el);
        if (t) return t;
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Feedback on the button
  // -------------------------------------------------------------------------

  // The label injected onto the page — keep in sync with injectButton()
  const BTN_LABEL = "Export for Aqua Essence";

  function resetButton() {
    const btn = document.getElementById("aqe-export-btn");
    if (!btn) return;
    btn.textContent   = BTN_LABEL;
    btn.style.background = "#1a73e8";
  }

  /**
   * Show a result message on the export button.
   * The message persists until the user clicks "OK" or starts a new export.
   * An "OK" chip appears above the button to dismiss it explicitly.
   */
  function showFeedback(message, ok = true) {
    const btn = document.getElementById("aqe-export-btn");
    if (!btn) return;
    btn.textContent      = message;
    btn.style.background = ok ? "#34a853" : "#d93025";

    // Inject a small OK button above the export button
    let okBtn = document.getElementById("aqe-ok-btn");
    if (!okBtn) {
      okBtn = document.createElement("button");
      okBtn.id = "aqe-ok-btn";
      Object.assign(okBtn.style, {
        position:     "fixed",
        bottom:       "62px",
        right:        "16px",
        zIndex:       "999999",
        padding:      "6px 18px",
        background:   "#fff",
        color:        "#202124",
        border:       "1px solid #dadce0",
        borderRadius: "6px",
        cursor:       "pointer",
        fontFamily:   "sans-serif",
        fontSize:     "13px",
        fontWeight:   "600",
        boxShadow:    "0 2px 8px rgba(0,0,0,0.2)",
      });
      document.body.appendChild(okBtn);
    }
    okBtn.textContent   = "OK";
    okBtn.style.display = "";
    okBtn.onclick = () => {
      okBtn.style.display = "none";
      resetButton();
    };
  }

  // -------------------------------------------------------------------------
  // Split-grid reader — shared by list-page scrapers
  // -------------------------------------------------------------------------

  /**
   * Read a Jackrabbit split grid. Jackrabbit list pages split two ways:
   * frozen-left columns vs. scrollable-right columns, and — for each half —
   * the header row and the data rows live in separate <table> elements.
   * Left/right body rows correspond by position.
   *
   * @param {RegExp} anchorPattern  Identifies the primary (left) body table:
   *   the one whose rows link to the detail page (e.g. /ClassDetail\?xID=/i).
   * @param {string[]} leftMarkers  Uppercase header names expected in the
   *   left half — used to pick the left header table when separate.
   * @param {string[]} rightMarkers Same for the right half.
   * @returns {Array<{anchor, pick}>|null}  One entry per left-half row:
   *   `anchor` is the detail link, `pick(...labels)` looks a column up in
   *   the left half first, then the paired right-half row.
   */
  function readSplitGrid(anchorPattern, leftMarkers, rightMarkers) {
    const allTables = [...document.querySelectorAll("table")].map((t) => ({
      headers: [...t.querySelectorAll("thead th, thead td")].map((el) => clean(el.innerText)),
      rows: [...t.querySelectorAll("tbody tr")]
        .map((tr) => ({
          cells:  [...tr.querySelectorAll("td")].map((td) => clean(td.innerText)),
          anchor: [...tr.querySelectorAll("a")].find((a) => anchorPattern.test(a.href)) || null,
        }))
        .filter((r) => r.cells.some((c) => c.length > 0)),
    }));
    const headerSets = allTables.filter((t) => t.headers.some((h) => h.length > 0));
    const bodySets   = allTables.filter((t) => t.rows.length > 0);

    const leftBody = bodySets.find((t) => t.rows.some((r) => r.anchor));
    if (!leftBody) return null;

    const matchesAny = (t, markers) =>
      t.headers.some((h) => markers.includes(h.toUpperCase()));

    const leftHeader =
      (leftBody.headers.some((h) => h.length > 0) && leftBody) ||
      headerSets.find((t) => matchesAny(t, leftMarkers)) ||
      headerSets[0] || { headers: [] };
    const rightHeader =
      headerSets.find((t) => t !== leftHeader && matchesAny(t, rightMarkers)) ||
      headerSets.find((t) => t !== leftHeader) || { headers: [] };
    const rightBody =
      bodySets.find((t) => t !== leftBody && t.rows.length === leftBody.rows.length) ||
      bodySets.find((t) => t !== leftBody) || null;

    console.log(
      `[AQE] splitGrid: tables=${allTables.length}, leftRows=${leftBody.rows.length}, ` +
      `rightRows=${rightBody ? rightBody.rows.length : 0}, ` +
      `leftHeaders=${leftHeader.headers.filter(Boolean).length}, ` +
      `rightHeaders=${rightHeader.headers.filter(Boolean).length}`
    );
    if (rightBody && rightBody.rows.length !== leftBody.rows.length) {
      console.warn(
        `[AQE] splitGrid: row count mismatch (left=${leftBody.rows.length}, ` +
        `right=${rightBody.rows.length}) — pairing by index anyway`
      );
    }

    return leftBody.rows.map((leftRow, i) => {
      const rightRow = rightBody ? rightBody.rows[i] : null;
      const pick = (...labels) =>
        getCell(leftHeader.headers, leftRow.cells, ...labels) ||
        (rightRow ? getCell(rightHeader.headers, rightRow.cells, ...labels) : "");
      return { anchor: leftRow.anchor, pick };
    });
  }

  // -------------------------------------------------------------------------
  // /Class/AllClasses — classes export (current session → classes.csv)
  // -------------------------------------------------------------------------

  /**
   * Split a Jackrabbit "Instructors" cell into individual name strings.
   * Handles "<synthetic instructor A>, <synthetic instructor B>" and single-name cells.
   */
  function splitInstructorNames(raw) {
    const s = String(raw || "").trim().replace(/^"|"$/g, "");
    if (!s) return [];
    return s.split(/,\s+(?=[A-Za-z])/).map((p) => p.trim()).filter(Boolean);
  }

  /**
   * On the AllClasses page: read every visible class row, fetch each
   * ClassDetail page to get instructor xIDs, then emit CLASS_BATCH.
   *
   * Output rows are in partner-CSV format (matching what import_classes()
   * reads), plus an extra `instructor_id` column with the Jackrabbit staff
   * xID.  Multi-instructor classes are split into one row per instructor,
   * while preserving the original Jackrabbit class xID on every row.
   *
   * If a class has no instructor xID (PrimaryTeacherID is empty), both
   * instructor_id and Instructors are left blank in the output row.
   */
  async function scrapeClassesExport() {
    const btn  = document.getElementById("aqe-export-btn");
    const host = location.hostname;

    _stopRequested = false;
    showStopButton();

    // ---- Read class rows from the DOM (split-grid layout) ----
    if (btn) btn.textContent = "Reading class list…";

    const gridRows = readSplitGrid(
      /ClassDetail\?xID=/i,
      ["CLASS", "CURRENT CLASSES", "DESCRIPTION"],
      ["DAYS", "START TIME", "END TIME", "SESSION", "OPEN", "SIZE"]
    );

    if (!gridRows || gridRows.length === 0) {
      hideStopButton();
      showFeedback("No class rows found on this page", false);
      return;
    }

    // Parse grid rows → class entry objects
    const classEntries = gridRows
      .map(({ anchor, pick }) => {
        const xIDMatch = anchor?.href.match(/xID=(\d+)/i);
        if (!xIDMatch) return null;
        return {
          xID:         xIDMatch[1],
          className:   pick("CLASS", "CURRENT CLASSES", "DESCRIPTION") || clean(anchor.innerText),
          instructors: pick("INSTRUCTORS", "INSTRUCTOR"),
          days:        pick("DAYS", "DAY"),
          startTime:   pick("START TIME"),
          endTime:     pick("END TIME"),
          location:    pick("LOCATION", "LOC"),
          status:      pick("STATUS"),
          session:     pick("SESSION"),
          open:        pick("OPEN"),
          size:        pick("SIZE"),
          startDate:   pick("START DATE"),
          endDate:     pick("END DATE"),
          cat1:        pick("CAT 1", "CAT1", "CATEGORY 1"),
        };
      })
      .filter(Boolean);

    if (classEntries.length === 0) {
      hideStopButton();
      showFeedback("Could not find class IDs — check the class links", false);
      return;
    }

    // Fill schedule fields missing from the visible table by parsing the
    // class name — import_classes() skips any row without Start/End Time,
    // and Size drives class capacity in the solver.
    for (const entry of classEntries) {
      const derived = deriveClassSchedule(entry.className);
      if (!entry.days)      entry.days      = derived.day;
      if (!entry.startTime) entry.startTime = derived.startTime;
      if (!entry.endTime)   entry.endTime   = derived.endTime;
      if (!entry.size)      entry.size      = derived.size;
    }

    console.log(`[AQE] Classes export: ${classEntries.length} classes`);

    // ---- Fetch instructor xIDs from ClassDetail (one fetch per class) ----
    const allRows  = [];
    let skipped    = 0;

    const tasks = classEntries.map((entry, idx) =>
      async () => {
        if (_stopRequested) return [];
        if (btn) btn.textContent = `Class ${idx + 1} / ${classEntries.length} — fetching…`;

        const instructorIds   = await fetchClassInstructorIds(host, entry.xID);
        const instructorNames = splitInstructorNames(entry.instructors);
        if (instructorIds.length === 0) {
          // Preserve the visible name while making the missing authoritative
          // instructor xID explicit in the contract.
          return [{
            "Class ID":      entry.xID,
            "Class":         entry.className,
            "instructor_id": "",
            "Instructors":   instructorNames.join(", "),
            "Days":          entry.days,
            "Start Time":    entry.startTime,
            "End Time":      entry.endTime,
            "Location":      entry.location,
            "Status":        entry.status,
            "Session":       entry.session,
            "Start Date":    entry.startDate,
            "End Date":      entry.endDate,
            "Cat 1":         entry.cat1,
            "Open":          entry.open,
            "Size":          entry.size,
          }];
        }

        // One output row per instructor (mirrors import_classes() split logic)
        return instructorIds.map((instrId, i) => ({
          "Class ID":      entry.xID,
          "Class":         entry.className,
          "instructor_id": instrId,
          "Instructors":   instructorNames[i] || instructorNames[0] || "",
          "Days":          entry.days,
          "Start Time":    entry.startTime,
          "End Time":      entry.endTime,
          "Location":      entry.location,
          "Status":        entry.status,
          "Session":       entry.session,
          "Start Date":    entry.startDate,
          "End Date":      entry.endDate,
          "Cat 1":         entry.cat1,
          "Open":          entry.open,
          "Size":          entry.size,
        }));
      }
    );

    // Run with bounded concurrency; add small delay between batches
    for (let bi = 0; bi < tasks.length; bi += FETCH_CONCURRENCY) {
      if (_stopRequested) break;
      const batch = await Promise.all(tasks.slice(bi, bi + FETCH_CONCURRENCY).map((t) => t()));
      for (const rows of batch) {
        if (rows.length === 0) skipped++;
        allRows.push(...rows);
      }
      if (bi + FETCH_CONCURRENCY < tasks.length) await sleep(FETCH_DELAY_MS);
    }

    if (allRows.length > 0) {
      chrome.runtime.sendMessage({ type: "CLASS_BATCH", rows: allRows });
    }

    hideStopButton();
    const stopped = _stopRequested;
    const incompleteRows = allRows.filter((row) =>
      !row.instructor_id || !row["Start Time"] || !row["End Time"]
    ).length;
    const warning = incompleteRows > 0
      ? ` — warning: ${incompleteRows} row(s) missing instructor ID or schedule time`
      : "";
    showFeedback(
      stopped
        ? `Stopped — ${allRows.length} class rows captured${warning}`
        : `Done — ${allRows.length} class rows from ${classEntries.length - skipped} classes` +
          (skipped > 0 ? ` (${skipped} incomplete tasks)` : "") + warning,
      !stopped && incompleteRows === 0
    );
  }

  // -------------------------------------------------------------------------
  // /Class/AllClasses — bulk historical pairings export (kept for reference)
  // -------------------------------------------------------------------------

  /**
   * On the AllClasses page: read each visible class row, fetch its ClassDetail
   * to get enrolled student IDs, then fetch each StudentDetail to read Past
   * Enrollment records.  Emits PAIRING_BATCH messages as each student is
   * processed.  Shows live progress on the export button.
   *
   * NOTE: This approach is slower than the Staff page export for historical
   * pairings.  Use scrapeStaffHistoryBulk() on the Staff list page instead.
   */
  async function scrapeAllClassesBulk() {
    const btn = document.getElementById("aqe-export-btn");
    const host = location.hostname;

    _stopRequested = false;
    showStopButton();

    // Build instructor last-name → staff xID map upfront
    if (btn) btn.textContent = "Loading staff list…";
    const staffMap = await fetchStaffMap(host);
    await sleep(FETCH_DELAY_MS);

    // Also try to read the AllClasses jqGrid from the live DOM.
    // It may have instructor staff IDs as a column, giving us a direct
    // classXID → instructorStaffId map that bypasses name matching entirely.
    const classInstructorMap = {};
    const allClassesGrids = document.querySelectorAll("table.ui-jqgrid-btable");
    for (const btable of allClassesGrids) {
      const container = btable.closest(".ui-jqgrid") || btable.parentElement;
      const rows = readJqGrid(container);
      if (!rows) continue;
      for (const r of rows) {
        const classId = numericXid(getJqCell(r, "ClassId", "ClassID", "xID", "Id"));
        const staffId = numericXid(getJqCell(r, "StaffId", "StaffID", "InstructorId", "InstructorID"));
        if (classId && staffId) classInstructorMap[classId] = staffId;
      }
    }
    console.log(`[AQE] AllClasses jqGrid: ${Object.keys(classInstructorMap).length} class/instructor mappings found`);

    // ---- Read the class list from the split-table AllClasses layout ----
    const tables = [...document.querySelectorAll("table")];
    let headers = [];
    let dataRows = []; // each entry: { cells: string[], anchors: HTMLAnchorElement[] }

    for (const t of tables) {
      const ths = [...t.querySelectorAll("thead th, thead td")].map((el) =>
        clean(el.innerText)
      );
      if (ths.some((h) => h.length > 0)) { headers = ths; break; }
    }

    for (const t of tables) {
      const trs = [...t.querySelectorAll("tbody tr")];
      const filled = trs
        .map((tr) => ({
          cells:   [...tr.querySelectorAll("td")].map((td) => clean(td.innerText)),
          anchors: [...tr.querySelectorAll("a")],
        }))
        .filter((row) => row.cells.some((c) => c.length > 0));
      if (filled.length > 0) { dataRows = filled; break; }
    }

    if (dataRows.length === 0) {
      hideStopButton();
      showFeedback("No class rows found on this page", false);
      return;
    }

    // Extract class xIDs from the class-name anchor href
    const classEntries = dataRows
      .map(({ cells, anchors }) => {
        const status = getCell(headers, cells, "STATUS");
        if (status === "Cancelled") return null;
        // Find the anchor whose href contains ClassDetail?xID=
        const classAnchor = anchors.find((a) =>
          /ClassDetail\?xID=/i.test(a.href)
        );
        const xIDMatch = classAnchor?.href.match(/xID=(\d+)/i);
        if (!xIDMatch) return null;
        return { xID: xIDMatch[1] };
      })
      .filter(Boolean);

    if (classEntries.length === 0) {
      hideStopButton();
      showFeedback("Could not find class IDs — check the class links", false);
      return;
    }

    // ---- Helper: update button with progress ----
    function setProgress(text) {
      if (btn) {
        btn.textContent = text;
        btn.style.background = "#1a73e8";
      }
    }

    let totalPairings = 0;
    let skippedClasses = 0;
    let classesDone = 0;

    for (let ci = 0; ci < classEntries.length; ci++) {
      if (_stopRequested) break;

      const { xID } = classEntries[ci];
      setProgress(`Class ${ci + 1} / ${classEntries.length} — fetching…`);

      await sleep(FETCH_DELAY_MS);
      if (_stopRequested) break;

      const classData = await fetchClassStudentIds(host, xID);
      if (!classData || classData.studentIds.length === 0) {
        skippedClasses++;
        classesDone = ci + 1;
        continue;
      }

      const { studentIds } = classData;

      // Deduplicate student IDs within this class (pairs may appear twice)
      const uniqueStudentIds = [...new Set(studentIds)];

      for (let si = 0; si < uniqueStudentIds.length; si++) {
        if (_stopRequested) break;

        const swimmerId = uniqueStudentIds[si];
        setProgress(
          `Class ${ci + 1}/${classEntries.length} — Student ${si + 1}/${uniqueStudentIds.length}`
        );

        await sleep(FETCH_DELAY_MS);
        if (_stopRequested) break;

        // staffMap is passed into fetchStudentPastEnrollment; the lookup is done
        // there using the Instructors field from each past enrollment row.
        const pairingRows = await fetchStudentPastEnrollment(host, swimmerId, staffMap);
        if (pairingRows.length > 0) {
          chrome.runtime.sendMessage({ type: "PAIRING_BATCH", rows: pairingRows });
          chrome.runtime.sendMessage({
            type:  "BULK_PROGRESS",
            done:  ci * 100 + si + 1,
            total: classEntries.length * 100,
            label: `Class ${ci + 1}/${classEntries.length} — Student ${si + 1}/${uniqueStudentIds.length}`,
          });
          totalPairings += pairingRows.length;
        }
      }

      classesDone = ci + 1;
    }

    hideStopButton();
    const stopped = _stopRequested;
    const skipNote = skippedClasses > 0 ? ` (${skippedClasses} skipped)` : "";
    showFeedback(
      stopped
        ? `Stopped — ${totalPairings} pairings from ${classesDone}/${classEntries.length} classes${skipNote}`
        : `Done — ${totalPairings} historical pairings from ${classEntries.length - skippedClasses} classes${skipNote}`
    );
  }

  // -------------------------------------------------------------------------
  // /Class/ClassDetail — enrolled students + instructor from page title
  // -------------------------------------------------------------------------

  function scrapeClassDetail() {
    const classId = numericXid(urlParam("xID"));
    if (!classId) {
      showFeedback("Could not read a numeric Class ID from this page", false);
      return;
    }

    // Instructor + slot from the <h1>: "Class: Adult Monday 8:30 pm 2:1 Kenaston"
    const h1 = document.querySelector("h1, h2, h3");
    const rawTitle = h1
      ? clean(h1.innerText).replace(/^Class:\s*/i, "")
      : "";
    const { instructorLastName } = parseClassName(rawTitle);
    const instructorIds = ["PrimaryTeacherID", "Teacher2ID", "Teacher3ID", "Teacher4ID"]
      .map((id) => numericXid(document.getElementById(id)?.value))
      .filter(Boolean);

    // ClassDetail also uses jqGrid. Find the enrollment grid container:
    // try the known div ID first, then fall back to any jqGrid on the page
    // that has a Student column.
    const enrollContainer =
      document.getElementById("EnrollResults") ||
      document.getElementById("ClassEnrollResults") ||
      (() => {
        // Generic fallback: find the ClassDetail enrollment btable by ID pattern
        // then use the closest .divResults wrapper as the container.
        const bt =
          document.querySelector("table.ui-jqgrid-btable[id*='ClassDetailEnrollment']") ||
          document.querySelector("table.ui-jqgrid-btable[id*='Enrollment']");
        if (bt) return bt.closest(".divResults") || bt.closest(".ui-jqgrid") || bt.parentElement;
        // Last resort: any btable with a StudentId or StudentName column
        for (const bt2 of document.querySelectorAll("table.ui-jqgrid-btable")) {
          const firstRow = bt2.querySelector("tr.jqgrow");
          if (!firstRow) continue;
          const hasStudent = [...firstRow.querySelectorAll("td")].some((td) => {
            const by = (td.getAttribute("aria-describedby") || "").toLowerCase();
            return by.includes("studentid") || by.includes("studentname");
          });
          if (hasStudent) return bt2.closest(".divResults") || bt2.parentElement;
        }
        return null;
      })();

    const studentRecords = [];
    const pairingRecords = [];

    if (enrollContainer) {
      const jqRows = readJqGrid(enrollContainer);
      if (jqRows) {
        for (const rec of jqRows) {
          // Column names confirmed: StudentName, StudentId, BirthDate, AgeWithMonths
          const fullName = getJqCell(rec, "StudentName", "Student");
          if (!fullName) continue;
          const parts     = fullName.split(/\s+/);
          const firstName = parts[0] || "";
          const lastName  = parts.slice(1).join(" ") || "";
          const dob       = getJqCell(rec, "BirthDate", "BirthDt", "DOB");
          const age       = getJqCell(rec, "AgeWithMonths", "Age");

          // swimmer_id from StudentId hidden column
          const swimmerId = numericXid(getJqCell(rec, "StudentId", "StudentID"));
          if (!swimmerId) continue;

          studentRecords.push({
            "Student ID":         swimmerId,
            "Student First Name": firstName,
            "Student Last Name":  lastName,
            "Family":             "",
            "Status":             "Active",
            "DOB":                dob,
            "Age":                age,
            "Current Classes":    rawTitle,
            // A class label is not authoritative for an individual swimmer's
            // RSS level. Leave this blank unless Jackrabbit exposes that field.
            "Skill Level":        "",
            "Notes":              "",
            "Special Needs":      "",
          });

          for (const instructorId of instructorIds.length > 0 ? instructorIds : [""]) {
            pairingRecords.push({
              swimmer_id:    swimmerId,
              class_id:      classId,
              instructor_id: instructorId,
              class_name:    rawTitle,
              session:       "",
              status:        "active",
            });
          }
        }
      }
    }

    if (studentRecords.length > 0) {
      chrome.runtime.sendMessage({ type: "STUDENT_BATCH", rows: studentRecords });
      chrome.runtime.sendMessage({ type: "PAIRING_BATCH", rows: pairingRecords });
      showFeedback(
        `Captured ${studentRecords.length} student(s) — instructor: ${instructorLastName}`
      );
    } else {
      showFeedback("No students found in enrollment list", false);
    }
  }

  // -------------------------------------------------------------------------
  // /Student/StudentDetail — past + current enrollment
  // -------------------------------------------------------------------------

  function scrapeStudentDetail() {
    const swimmerId = numericXid(urlParam("xID"));
    if (!swimmerId) {
      showFeedback("Could not read a numeric Student ID from this page", false);
      return;
    }

    // Student name from <h1> "Student: Simranpreet Singh"
    const h1 = document.querySelector("h1, h2");
    const heading = h1
      ? clean(h1.innerText).replace(/^Student:\s*/i, "")
      : "";
    const nameParts = heading.split(/\s+/);
    let firstName = nameParts[0] || "";
    let lastName  = nameParts.slice(1).join(" ") || "";

    // Form inputs are more reliable (pre-filled with exact values)
    const firstInput = document.querySelector(
      'input[id*="irstName"], input[name*="irstName"]'
    );
    const lastInput = document.querySelector(
      'input[id*="astName"], input[name*="astName"]'
    );
    if (firstInput?.value) firstName = firstInput.value.trim();
    if (lastInput?.value)  lastName  = lastInput.value.trim();

    // Family name from the link next to the "Family:" label
    let family = "";
    for (const a of document.querySelectorAll("a")) {
      const labelCell = a.closest("td")?.previousElementSibling;
      if (labelCell && /family/i.test(labelCell.innerText)) {
        family = clean(a.innerText);
        break;
      }
    }

    const pairingRecords = [];
    /**
     * Read enrollment rows from a jqGrid container (by known div ID) and push
     * pairing records.  Jackrabbit uses jqGrid throughout StudentDetail — the
     * heading-proximity approach cannot work here.
     */
    function readEnrollSection(divId, isHistorical) {
      const container = document.getElementById(divId);
      if (!container) return;
      const records = readJqGrid(container);
      if (!records) return;
      for (const rec of records) {
        const className   = getJqCell(rec, "Class");
        const session     = getJqCell(rec, "Session");
        const instructors = getJqCell(rec, "Instructors");
        if (!className && !instructors) continue;
        pairingRecords.push({
          swimmer_id:    swimmerId,
          class_id:      numericXid(getJqCell(rec, "ClassID")),
          class_name:    className,
          session,
          status:        isHistorical === "yes" ? "archived" : "active",
        });
      }
    }

    // Stable div IDs — Jackrabbit has used these since at least jr4.0
    readEnrollSection("PastEnrollResults",    "yes");
    readEnrollSection("CurrEnrollResults",    "no");

    // Always emit a student record for this page
    chrome.runtime.sendMessage({
      type: "STUDENT_BATCH",
      rows: [{
        "Student ID":         swimmerId,
        "Student First Name": firstName,
        "Student Last Name":  lastName,
        "Family":             family,
        "Status":             clean(
          document.querySelector("#StudentStatus, #Status")?.value ||
          document.querySelector("#StudentStatus option:checked, #Status option:checked")?.textContent
        ),
        "DOB":                "",   // DOB shown on ClassDetail, not here
        "Age":                "",
        "Current Classes":    "",
        "Skill Level":        "",
        "Notes":              "",
        "Special Needs":      "",
      }],
    });

    if (pairingRecords.length > 0) {
      chrome.runtime.sendMessage({ type: "PAIRING_BATCH", rows: pairingRecords });
      const hist = pairingRecords.filter((r) => r.status === "archived").length;
      const curr = pairingRecords.length - hist;
      showFeedback(
        `${firstName} ${lastName}: ${hist} past + ${curr} current pairing(s)`
      );
    } else {
      showFeedback(`Captured student: ${firstName} ${lastName}`, true);
    }
  }

  // -------------------------------------------------------------------------
  // /Student/ListStudents — students list bulk export
  // -------------------------------------------------------------------------

  /** Split a displayed student name into first/last. Handles "<synthetic last name>, <synthetic first name>". */
  function splitStudentName(nameText) {
    const commaSplit = String(nameText || "").split(/\s*,\s*/);
    if (commaSplit.length > 1) {
      return { firstName: commaSplit[1].trim(), lastName: commaSplit[0].trim() };
    }
    const parts = clean(nameText).split(/\s+/);
    return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
  }

  /**
   * Read the student list from the DOM already rendered on the page.
   * Respects whatever filter the user has applied — only returns visible rows.
   *
   * Mirrors readStaffFromPageDom(): jqGrid first, then StudentDetail-anchor
   * fallbacks for the split-table layout. Returns STUDENT_BATCH-shaped rows.
   */
  function readStudentsFromPageDom() {
    const students = [];
    const seen     = new Set();

    console.log("[AQE] readStudentsFromPageDom diagnostics:");
    console.log("  table.ui-jqgrid-btable:", document.querySelectorAll("table.ui-jqgrid-btable").length);
    console.log("  tr.jqgrow:", document.querySelectorAll("tr.jqgrow").length);
    console.log("  a[href*=StudentDetail]:", document.querySelectorAll("a[href*='StudentDetail']").length);

    function addStudent(rec) {
      const id = numericXid(rec["Student ID"]);
      if (!id || seen.has(id)) return;
      seen.add(id);
      students.push({ ...rec, "Student ID": id });
    }

    // Strategy 1 — jqGrid rows (column names from aria-describedby)
    for (const btable of document.querySelectorAll("table.ui-jqgrid-btable")) {
      const container = btable.closest(".ui-jqgrid") || btable.parentElement;
      const rows = readJqGrid(container);
      if (!rows || rows.length === 0) continue;
      console.log(`[AQE] Students S1: ${rows.length} rows, sample keys:`, Object.keys(rows[0]));
      for (const rec of rows) {
        const studentId = numericXid(getJqCell(rec, "StudentId", "StudentID", "xID", "Id"));
        if (!studentId) continue;
        let firstName = getJqCell(rec, "FirstName", "StudentFirstName", "First");
        let lastName  = getJqCell(rec, "LastName", "StudentLastName", "Last");
        if (!firstName && !lastName) {
          ({ firstName, lastName } =
            splitStudentName(getJqCell(rec, "StudentName", "Student", "Name")));
        }
        addStudent({
          "Student ID":         studentId,
          "Student First Name": firstName,
          "Student Last Name":  lastName,
          "Family":             getJqCell(rec, "Family", "FamilyName", "FamilyLastName"),
          "Status":             getJqCell(rec, "Status"),
          "DOB":                getJqCell(rec, "BirthDate", "BirthDt", "DOB"),
          "Age":                getJqCell(rec, "AgeWithMonths", "Age"),
          "Current Classes":    getJqCell(rec, "CurrentClasses", "Classes", "CurrentClass"),
          "Skill Level":        "",
          "Notes":              "",
          "Special Needs":      getJqCell(rec, "SpecialNeeds", "Disabilities"),
        });
      }
      if (students.length > 0) return students;
    }

    // Strategy 2 — split-table layout. Jackrabbit splits the list two ways:
    //   * frozen left columns (Location / First / Last / Family + the
    //     StudentDetail link) vs. the remaining columns (Status / DOB / Age /
    //     Current Classes / Notes / Special Needs / …), and
    //   * for each half, the header row and the data rows live in SEPARATE
    //     <table> elements.
    // So: collect header tables and body tables independently, associate
    // them by content, and pair left/right body rows index-by-index.
    const allTables = [...document.querySelectorAll("table")].map((t) => ({
      headers: [...t.querySelectorAll("thead th, thead td")].map((el) => clean(el.innerText)),
      rows: [...t.querySelectorAll("tbody tr")]
        .map((tr) => ({
          cells:  [...tr.querySelectorAll("td")].map((td) => clean(td.innerText)),
          anchor: [...tr.querySelectorAll("a")].find((a) => /StudentDetail/i.test(a.href)) || null,
        }))
        .filter((r) => r.cells.some((c) => c.length > 0)),
    }));
    const headerSets = allTables.filter((t) => t.headers.some((h) => h.length > 0));
    const bodySets   = allTables.filter((t) => t.rows.length > 0);

    const leftBody = bodySets.find((t) => t.rows.some((r) => r.anchor));
    if (!leftBody) {
      console.warn("[AQE] readStudentsFromPageDom: no rows with StudentDetail links found");
      return students;
    }
    // Header set for the left half: same table if combined, else the header
    // table that names the student-name columns, else the first header table.
    const leftHeader =
      (leftBody.headers.some((h) => h.length > 0) && leftBody) ||
      headerSets.find((t) => t.headers.some((h) => h.toUpperCase().includes("STUDENT FIRST NAME"))) ||
      headerSets[0] || { headers: [] };
    const rightHeader =
      headerSets.find((t) => t !== leftHeader &&
        t.headers.some((h) => ["STATUS", "DOB", "AGE"].includes(h.toUpperCase()))) ||
      headerSets.find((t) => t !== leftHeader) || { headers: [] };
    // Body table for the right half: prefer a row-count match with the left.
    const rightBody =
      bodySets.find((t) => t !== leftBody && t.rows.length === leftBody.rows.length) ||
      bodySets.find((t) => t !== leftBody) || null;

    console.log(
      `[AQE] Students S2: tables=${allTables.length}, leftRows=${leftBody.rows.length}, ` +
      `rightRows=${rightBody ? rightBody.rows.length : 0}, ` +
      `leftHeaders=${leftHeader.headers.filter(Boolean).length}, ` +
      `rightHeaders=${rightHeader.headers.filter(Boolean).length}`
    );
    if (rightBody && rightBody.rows.length !== leftBody.rows.length) {
      console.warn(
        `[AQE] Students S2: row count mismatch (left=${leftBody.rows.length}, ` +
        `right=${rightBody.rows.length}) — pairing by index anyway`
      );
    }

    leftBody.rows.forEach((leftRow, i) => {
      if (!leftRow.anchor) return;
      const rightRow = rightBody ? rightBody.rows[i] : null;

      // Look a field up in the left half first, then the paired right row.
      const pick = (...labels) =>
        getCell(leftHeader.headers, leftRow.cells, ...labels) ||
        (rightRow ? getCell(rightHeader.headers, rightRow.cells, ...labels) : "");

      const match = leftRow.anchor.href.match(/[?&]xID=(\d+)/i);
      const studentId = numericXid(match ? match[1] : pick("JACKRABBIT STUDENT ID"));
      if (!studentId) return;

      let firstName = pick("STUDENT FIRST NAME", "FIRST NAME");
      let lastName  = pick("STUDENT LAST NAME", "LAST NAME");
      if (!firstName && !lastName) {
        ({ firstName, lastName } = splitStudentName(clean(leftRow.anchor.innerText)));
      }

      addStudent({
        "Student ID":         studentId,
        "Student First Name": firstName,
        "Student Last Name":  lastName,
        "Family":             pick("FAMILY"),
        "Status":             pick("STATUS"),
        "DOB":                pick("DOB", "BIRTH DATE"),
        "Age":                pick("AGE"),
        "Current Classes":    pick("CURRENT CLASSES"),
        "Skill Level":        "",
        "Notes":              pick("NOTES"),
        "Special Needs":      pick("SPECIAL NEEDS") || pick("DISABILITIES"),
      });
    });
    if (students.length === 0) {
      console.warn("[AQE] readStudentsFromPageDom: no student rows found");
    }
    return students;
  }

  /**
   * On the Students list page: read every visible student row and emit a
   * STUDENT_BATCH. Download via the popup's "students CSV" button — the
   * output matches what import_students() expects (Student ID, names,
   * Family, Status, Age, …).
   */
  function scrapeStudentsListBulk() {
    const students = readStudentsFromPageDom();
    if (students.length === 0) {
      showFeedback("No students found on this page — apply a filter or check the list", false);
      return;
    }
    chrome.runtime.sendMessage({ type: "STUDENT_BATCH", rows: students });
    showFeedback(`Captured ${students.length} student(s) — download from the popup`);
  }

  // -------------------------------------------------------------------------
  // Route to the right scraper
  // -------------------------------------------------------------------------

  function scrapeCurrentPage() {
    // Orphaned-script guard: after the extension is reloaded/updated, content
    // scripts already injected into open tabs lose their runtime connection.
    // Fetches still work but every sendMessage throws, so bulk exports die
    // silently mid-run. Tell the user to refresh instead of hanging.
    if (!chrome.runtime?.id) {
      showFeedback("Extension was updated — refresh this page (F5) and try again", false);
      return;
    }

    const path = location.pathname.toLowerCase();
    if (path.includes("/class/classdetail")) {
      scrapeClassDetail();
    } else if (path.includes("/student/studentdetail")) {
      scrapeStudentDetail();
    } else if (path.includes("liststudents") || path.includes("/student/students")) {
      // Students list export — emit students.csv rows from the visible list
      scrapeStudentsListBulk();
    } else if (path.includes("allclasses")) {
      // Classes export — emit classes.csv rows with instructor xIDs
      const btn = document.getElementById("aqe-export-btn");
      if (btn) btn.disabled = true;
      scrapeClassesExport().finally(() => {
        if (btn) btn.disabled = false;
        hideStopButton();
      });
    } else if (path.includes("/staff/listinstructors") || path.includes("/staff/staffdetail")) {
      // Staff History bulk export — all sessions, all instructors
      const btn = document.getElementById("aqe-export-btn");
      if (btn) btn.disabled = true;
      scrapeStaffHistoryBulk().finally(() => {
        if (btn) btn.disabled = false;
        hideStopButton();
      });
    } else if (document.querySelector("a[href*='StudentDetail']")) {
      // URL didn't match a known pattern, but the page lists students —
      // Jackrabbit's student-list path varies between deployments, so fall
      // back to detecting StudentDetail links in the DOM.
      scrapeStudentsListBulk();
    } else {
      showFeedback("Not a recognised Jackrabbit page", false);
    }
  }

  // -------------------------------------------------------------------------
  // Inject export button + stop button
  // -------------------------------------------------------------------------

  function injectExportButton() {
    if (document.getElementById("aqe-export-btn")) return;
    const btn = document.createElement("button");
    btn.id = "aqe-export-btn";
    btn.textContent = "Export for Aqua Essence";
    Object.assign(btn.style, {
      position:     "fixed",
      bottom:       "16px",
      right:        "16px",
      zIndex:       "999999",
      padding:      "10px 16px",
      background:   "#1a73e8",
      color:        "#fff",
      border:       "none",
      borderRadius: "6px",
      cursor:       "pointer",
      fontFamily:   "sans-serif",
      fontSize:     "13px",
      boxShadow:    "0 2px 8px rgba(0,0,0,0.3)",
    });
    btn.addEventListener("click", scrapeCurrentPage);
    document.body.appendChild(btn);
  }

  function injectStopButton() {
    if (document.getElementById("aqe-stop-btn")) return;
    const btn = document.createElement("button");
    btn.id = "aqe-stop-btn";
    btn.textContent = "Stop";
    Object.assign(btn.style, {
      position:     "fixed",
      bottom:       "108px",  // above the OK button (62px) + gap
      right:        "16px",
      zIndex:       "999999",
      padding:      "10px 16px",
      background:   "#d93025",
      color:        "#fff",
      border:       "none",
      borderRadius: "6px",
      cursor:       "pointer",
      fontFamily:   "sans-serif",
      fontSize:     "13px",
      boxShadow:    "0 2px 8px rgba(0,0,0,0.3)",
      display:      "none",   // hidden until a bulk export starts
    });
    btn.addEventListener("click", () => {
      _stopRequested = true;
      btn.textContent = "Stopping…";
      btn.disabled = true;
    });
    document.body.appendChild(btn);
  }

  injectExportButton();
  injectStopButton();
  new MutationObserver(() => { injectExportButton(); injectStopButton(); }).observe(document.body, {
    childList: true,
    subtree: false,
  });
})();
