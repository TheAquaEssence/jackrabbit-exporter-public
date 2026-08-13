# Repository guide

## Architecture

- `manifest.json` defines the standalone Manifest V3 extension for Chromium and Firefox.
- `content.js` detects supported authenticated Jackrabbit pages, extracts records from page DOM/jqGrid responses, and sends typed batches to the background context.
- `background.js` owns the temporary export buffer, restores it from extension storage, deduplicates captured batches, reports bulk progress, and clears all buffered record types.
- `popup.html` and `popup.js` show buffer status and provide individual CSV downloads plus the one-click Aqua Essence bundle download.
- `utils/csv_builder.js` is the file-contract boundary. It owns exact CSV headers, escaping, validation, deduplication, and bundle serialization.
- `tests/` contains Node tests. Fixtures must be synthetic and must never contain copied operational data.

This repository remains independent from the Aqua Essence desktop matcher. Integration occurs only through the versioned downloaded file contract; do not add a runtime, source-code, package, or repository dependency on the desktop application.

## Bundle contract

The desktop handoff filename is `aqua_essence_jackrabbit_export.json`.

- `format`: `aqua-essence-jackrabbit-export`
- `format_version`: `1`
- `exporter`: exporter name and extension version metadata
- `exported_at`: ISO-8601 timestamp
- `files`: an object containing exactly these CSV payloads:
  - `jackrabbit_students.csv`
  - `jackrabbit_classes.csv`
  - `jackrabbit_staff.csv`
  - `jackrabbit_pairings.csv`

The header constants in `utils/csv_builder.js` are authoritative for format version 1 and are locked by tests. Students and classes are required before bundle generation. Staff is captured directly when available and may be supplemented only from numeric instructor xIDs present in captured classes. Pairings may be header-only. Preserve Jackrabbit Student, Class, and Staff xIDs as digit strings; never synthesize or numerically coerce them.

## Data integrity and privacy

- Never invent swimmer RSS levels, medical/special-needs flags, instructor certifications, or other missing source values. Leave unavailable fields blank and surface incomplete extraction to the user.
- Curated instructor profiles belong to the separate desktop matcher. Never export them as authoritative Jackrabbit staff data.
- Never place real student, medical, enrollment, staff, class, pairing, credential, account, or session data in source, tests, logs, screenshots, documentation, issues, or commits.
- Use obviously synthetic people and identifiers in tests and examples.
- Do not log extracted row contents or authenticated endpoint URLs containing record xIDs. Aggregate counts and structural diagnostics are acceptable.
- Captured data stays in extension storage until the user selects **Clear buffer**. Downloads are user-initiated and no operational data is sent to a third party.

## Development commands

Use Node.js 20 or newer.

```sh
npm test
npm run check
npm run release:check
```

Run both commands before edits to establish a baseline and again after edits. Reload the unpacked extension after runtime changes. Live verification must use an authorized Jackrabbit account and must not record operational data.

Use `npm run release:check` for release preparation. It validates and creates deterministic Chromium and Firefox archives in ignored `dist/`; do not commit those generated artifacts.

## Repository conventions

- Preserve unrelated and pre-existing uncommitted changes.
- Keep implementation browser-native and dependency-free unless a dependency is explicitly justified.
- Keep Chrome, Edge, and Firefox behavior aligned; do not use Chromium-only APIs without a tested fallback.
- Treat CSV header changes, filename changes, and bundle-shape changes as versioned integration-contract changes.
- Add or update tests with every contract or state-management change.
- Keep permissions and host access minimal, extension assets local, and all code compatible with the declared browser minimums.
- Do not commit, push, publish, change repository visibility, or include generated operational exports unless the user explicitly requests it.
