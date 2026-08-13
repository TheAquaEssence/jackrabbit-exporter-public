# Deferred roadmap

These ideas are intentionally outside the version 1.1.0 production baseline.
They should be considered only after the current bundle contract and browser
matrix have completed live validation.

## Filtered historical-pairing capture

Allow the user to select the class/session/status scope before fetching
historical pairings—for example, classes that have just concluded—instead of
requesting every instructor's complete class history on each update.

Design constraints:

- Filtering must happen before enrollment/drop-list requests so it reduces
  authenticated network work, not merely the final CSV rows.
- The default must remain correctness-first and must not silently omit new or
  changed pairings because a class has some rows in the buffer.
- Supported filters and their source fields must be verified against authorized
  Jackrabbit pages in Chrome, Edge, and Firefox.
- The UI must clearly show the selected scope and whether a run was partial.
- Repeated runs must remain idempotent through the existing composite pairing
  identity and must not change the format-version-1 CSV header.
- Any persisted completion marker must be explicit and refreshable; the mere
  presence of one buffered pairing is not proof that a class was fully captured.

## Possible safe optimization

After live endpoint validation, consider recording a non-sensitive completion
marker keyed by numeric class and instructor xIDs for concluded classes. This
could support an explicit **skip completed classes** option. It must remain
opt-in or offer a forced refresh so newly corrected Jackrabbit data is not
missed.
