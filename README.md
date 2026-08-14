# Jackrabbit Exporter

Jackrabbit Exporter is a Chrome, Edge, and Firefox browser extension that
exports Jackrabbit Class records as CSV files compatible with Aqua Essence.
It can export students, classes, staff, and historical swimmer/instructor
pairings in a single versioned handoff file.

This directory is a standalone extension project. It has no runtime dependency
on the Aqua Essence application repository. The repositories integrate only
through the format-version-1 file contract described below.

Version 1.1.0 is the production baseline for internal Chrome and Edge use.
Firefox packaging remains available from the same source, but live Firefox
validation was explicitly waived for the current company rollout.

## Install from source

### Chrome or Edge

1. Open `chrome://extensions/` or `edge://extensions/`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the directory containing `manifest.json`.

### Firefox 121+

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on**.
3. Select `manifest.json`.

Firefox removes temporary add-ons after restart. Permanent distribution
requires Mozilla signing.

Chrome and Edge 121 or newer are required. The manifest intentionally declares
both the Chromium service worker and Firefox event-page background entry so the
same source package works in all three browsers.

## Usage

1. Sign in to the authorized Jackrabbit Class account.
2. Navigate to the supported student, class, or staff page.
3. Use the blue **Export for Aqua Essence** control added to the page.
4. Wait for any bulk export to finish.
5. Open the extension popup and select **Download Aqua Essence bundle**.
6. In an Aqua Essence desktop build that implements format version 1, choose
   the downloaded `aqua_essence_jackrabbit_export.json` file.
7. Select **Clear buffer** when the captured data is no longer needed.

Students and classes are the only required datasets for bundle generation.
Staff is taken from an explicit staff capture when available and supplemented
from numeric instructor IDs on captured class rows. If no historical pairings
were captured, the bundle contains a header-only pairings CSV. The popup shows
contract-blocking errors and extraction warnings before download.

Some bulk exports request related Jackrabbit pages and grid endpoints using the
existing authenticated browser session. The extension does not collect the
user's credentials or send exported records to a third-party service. See
[PRIVACY.md](PRIVACY.md) for the complete data-handling summary.

## CSV contracts

The recommended handoff is a versioned JSON bundle with
`format: "aqua-essence-jackrabbit-export"` and `format_version: 1`. Its `files`
object contains the CSV contracts below, allowing the desktop app to validate
compatibility and select every source in one step.

The top-level bundle keys are `format`, `format_version`, `exported_at`,
`exporter`, and `files`. `exported_at` is an ISO-8601 timestamp and `exporter`
contains the extension name and version. Student, Class, and Staff xIDs are
preserved as digit strings, including leading zeroes. Multi-instructor class
rows repeat the real Class ID; the exporter never creates a replacement ID.

### `jackrabbit_students.csv`

`Student ID`, `Student First Name`, `Student Last Name`, `Family`, `Status`,
`DOB`, `Age`, `Current Classes`, `Skill Level`, `Notes`, `Special Needs`

### `jackrabbit_classes.csv`

`Class ID`, `Class`, `instructor_id`, `Instructors`, `Days`, `Start Time`,
`End Time`, `Location`, `Status`, `Session`, `Start Date`, `End Date`, `Cat 1`,
`Open`, `Size`

### `jackrabbit_pairings.csv`

`swimmer_id`, `class_id`, `instructor_id`, `class_name`, `session`, `status`

### `jackrabbit_staff.csv`

`Staff ID`, `Name`, `Status`, `Position`, `Instructor`

The contracts are intentionally tested because Aqua Essence imports these
headers directly.

Missing source fields remain blank. In particular, the extension does not
derive an individual swimmer's RSS level from a class name, invent medical or
special-needs flags, or export desktop-curated instructor certifications as
Jackrabbit facts.

## Supported capture pages

- Student list pages capture the visible filtered student rows.
- Student detail pages capture that student and visible current/past enrollment
  pairings.
- Class detail pages capture visible enrolled students and their active pairing.
- **AllClasses** captures the visible filtered class rows and requests each
  class detail page to obtain numeric instructor xIDs.
- **ListInstructors** and staff detail pages capture staff and request class
  history/enrollment grids for historical pairings.

Jackrabbit list layouts are account-configurable. If a required ID cannot be
read, capture is blocked or the popup reports the incomplete extraction rather
than substituting data.

The exporter side of the desktop handoff is complete. Desktop import behavior
belongs in the independent Aqua Essence repository and must consume only the
versioned downloaded file contract documented here.

## Development

Node.js 20 or newer is used only for local validation; it is not required to
run the extension.

```sh
npm test
npm run check
npm run release:check
```

`npm run release:check` runs the complete deterministic packaging gate and
writes versioned Chromium and Firefox ZIP files plus SHA-256 checksums to the
ignored `dist/` directory. See [RELEASE.md](RELEASE.md) for artifact contents
and the release procedure. The prepared 1.1.0 changes are summarized in
[RELEASE_NOTES_1.1.0.md](RELEASE_NOTES_1.1.0.md).

After changing extension behavior, reload the unpacked extension and exercise
the affected workflow using an authorized test account. Follow the
[manual validation checklist](MANUAL_VALIDATION.md). Never place real student,
medical, enrollment, staff, class, pairing, credential, or session records in
tests, logs, screenshots, issues, documentation, or commits.

## Security and privacy

The extension has access to operational data visible in Jackrabbit Class.
Review [PRIVACY.md](PRIVACY.md) before use and follow [SECURITY.md](SECURITY.md)
when reporting vulnerabilities.

## License

Licensed under the [MIT License](LICENSE).
