# Jackrabbit Exporter 1.1.0

Version 1.1.0 introduces the versioned one-file handoff for Aqua Essence and
hardens extraction, storage, privacy, and release validation.

## Highlights

- Added `aqua_essence_jackrabbit_export.json` with bundle format
  `aqua-essence-jackrabbit-export`, format version `1`, exporter metadata, an
  ISO timestamp, and all four CSV payloads.
- Added Jackrabbit staff capture and staff supplementation from numeric class
  instructor xIDs.
- Added one-click bundle download. Students and classes are required; staff and
  historical pairings may be header-only when unavailable.
- Preserved numeric Student, Class, and Staff xIDs as strings. Multi-instructor
  class rows retain the original Class ID.
- Added buffer deduplication, backward-compatible state restoration, reliable
  clearing, progress completion, and visible extraction diagnostics.
- Stopped inferring missing swimmer RSS levels or other unavailable operational
  values and removed record-level diagnostic logging.
- Replaced operational-looking source examples with explicit synthetic
  placeholders and added a regression check for scraper comments.
- Reduced extension permissions to `storage` plus the documented Jackrabbit host
  access.
- Added deterministic Chromium/Firefox ZIP packaging, SHA-256 checksums, release
  validation, and CI checks.

## Compatibility

- Chrome and Edge 121 or newer.
- Firefox 121 or newer at the manifest/package level; live Firefox validation
  was waived for the current internal Chrome/Edge rollout.
- Aqua Essence bundle contract format version `1`.
- Existing individual CSV download actions remain available.

## Validation

- Automated tests: 20 passed.
- JavaScript syntax, manifest, packaged assets, ZIP integrity, and repeat-build
  reproducibility checks passed.
- Edge live validation was accepted for the production baseline, including
  student/class capture, staff and pairings, one-click desktop handoff, stopping,
  clearing, and deduplication.
- Chrome live validation was accepted for installation, capture, one-click
  bundle download, clearing, and numeric xID preservation.
- A live multi-instructor capture confirmed distinct instructor rows retain the
  same original numeric Class ID without duplicate Class ID/instructor ID pairs.
- Incomplete class extraction produced a visible warning instead of invented
  instructor or schedule data.
- Firefox live smoke testing was explicitly waived by the project owner.
- Prepared artifact SHA-256 for both target ZIP files:

  `5fc906146a547ccd0de741c7c3e2913bdd5f057c7d6942e5928f6ba20690e439`

Re-run `npm run release:check` immediately before release and update this hash if
the source changes.
