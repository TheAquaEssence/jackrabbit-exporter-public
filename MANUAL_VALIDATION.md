# Manual validation checklist

Use this checklist only with an authorized Jackrabbit account. Prefer a
dedicated test account populated with synthetic records. Do not take
screenshots, record the screen, copy operational records into notes, preserve
network logs, or attach downloaded exports to issues or commits. Record only
pass/fail results, browser versions, page type, and sanitized error summaries.

## Preparation

- [ ] Use Chrome 121+, Edge 121+, or Firefox 121+ in a clean test profile.
- [ ] Run `npm test` and `npm run check` successfully.
- [ ] Load the repository root as an unpacked/temporary extension.
- [ ] Confirm the extension requests only `storage` and the two
      documented Jackrabbit HTTPS host patterns.
- [ ] Sign in to the authorized Jackrabbit test account.
- [ ] Open the popup, select **Clear buffer**, close and reopen the popup, and
      confirm all five counters are zero and no progress indicator remains.
- [ ] Keep developer tools recording disabled. If diagnostics are needed,
      inspect aggregate messages only and clear the console afterward.

## Page detection and student capture

- [ ] On an unrelated Jackrabbit page, select the injected export control and
      confirm it reports that the page is not recognized without capturing data.
- [ ] On the student list, apply a small authorized filter and capture it.
- [ ] Confirm only visible filtered rows are counted and a second capture does
      not increase the unique student count or student-page count.
- [ ] Confirm Student IDs in a local, transient inspection are the original
      numeric xIDs and remain text (including any leading zeroes).
- [ ] Confirm unavailable RSS level, notes, and special-needs fields remain
      blank; no value is inferred from a class label or another source.
- [ ] On one student detail page, confirm current and past enrollment sections
      are detected without reading unrelated page tables.
- [ ] Confirm a page without a numeric Student xID reports an extraction error.

## Class capture

- [ ] On **AllClasses**, apply a small authorized session/filter and capture it.
- [ ] Confirm all visible classes are represented and duplicate captures do not
      increase the unique class/instructor row count.
- [ ] Confirm every Class ID is the original numeric Jackrabbit xID.
- [ ] For a multi-instructor class, confirm each instructor assignment has its
      own row and every row repeats the same original Class ID.
- [ ] Confirm numeric instructor xIDs come from the class detail fields. If an
      instructor ID is unavailable, confirm the visible name is retained, the
      ID stays blank, and the popup shows an extraction warning.
- [ ] Confirm missing class names or schedule times are shown as warnings rather
      than silently replaced with invented values.
- [ ] Stop a class capture mid-run and confirm partial results are identified as
      partial and the stop control exits cleanly.

## Staff and historical pairings

- [ ] On **ListInstructors**, use a small authorized active-staff filter and
      start capture.
- [ ] Confirm captured Staff IDs are the original numeric Jackrabbit xIDs and
      duplicate staff rows are merged.
- [ ] Confirm class-history progress advances, completes, and disappears from
      the popup when finished.
- [ ] Confirm archived classes use their drop-list enrollment and active classes
      use current enrollment, while cancelled classes are skipped.
- [ ] Confirm pairing rows preserve numeric swimmer, class, and instructor IDs,
      the source session, and the appropriate active/archived status.
- [ ] Repeat with no historical pairings and confirm bundle generation still
      works with a header-only `jackrabbit_pairings.csv` payload.
- [ ] Stop a staff-history capture and confirm the popup does not remain stuck in
      a running state.

## Bundle contract and clearing

- [ ] After clearing, capture students only and confirm bundle download remains
      disabled with a classes-required message.
- [ ] Capture classes and confirm bundle download becomes available even when
      there was no explicit staff capture.
- [ ] Download `aqua_essence_jackrabbit_export.json` to an approved temporary
      location and inspect it locally without copying its contents elsewhere.
- [ ] Confirm `format` is `aqua-essence-jackrabbit-export`, `format_version` is
      `1`, `exported_at` is an ISO timestamp, and exporter name/version are set.
- [ ] Confirm `files` contains exactly the four documented CSV filenames and
      every first line exactly matches the README header contract.
- [ ] Import the bundle into a compatible Aqua Essence desktop build and confirm
      it accepts the versioned contract without either repository depending on
      the other's source or runtime.
- [ ] Select **Clear buffer**, close/reopen the popup, and restart/reload the
      extension. Confirm no captured records or progress state return.
- [ ] Securely delete the downloaded validation bundle according to the
      organization's retention policy.

## Browser matrix

- [ ] Repeat install, capture, one-click bundle download, and clear-buffer smoke
      tests in current Chrome.
- [ ] Repeat the same smoke tests in current Edge.
- [ ] Repeat the same smoke tests in current Firefox, including temporary add-on
      reload behavior and the event-page background fallback.
- [ ] Record only browser/version and pass/fail outcomes; do not record account
      names, URLs with xIDs, row counts that are operationally sensitive, or
      extracted field values.

## Current validation record

The following privacy-safe results were reported and accepted for the 1.1.0
production baseline on August 13, 2026. The exact Edge version was not recorded.

- Edge: student-list recapture deduplicated student rows and the corrected
  student-page counter behavior was accepted.
- Edge: the format-version-1 student CSV contained the documented columns;
  `Skill Level` was blank when Jackrabbit exposed no authoritative value.
- Edge: class capture completed without missing-instructor or missing-schedule
  warnings.
- Edge: the remaining bundle, staff/pairing, stopping, clearing, and desktop
  handoff checks were accepted.

The production baseline is considered ready. These remaining checks are
explicitly deferred as non-blocking follow-up validation:

- Verify original Class ID preservation on a live multi-instructor class when
  one becomes available.
- Run installation, capture, bundle-download, and clear-buffer smoke tests in
  Chrome and Firefox.
