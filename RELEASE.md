# Release procedure

This project produces dependency-free, deterministic ZIP artifacts for
Chromium (Chrome and Edge) and Firefox. Both target archives currently contain
the same cross-browser Manifest V3 payload; distinct filenames make the store
submission target explicit.

## Version 1.1.0 release checklist

- [ ] Confirm `manifest.json` and `package.json` both specify `1.1.0`.
- [ ] Review the complete Git diff and confirm it contains no operational data.
- [ ] Run `npm run release:check` and confirm all tests and validations pass.
- [ ] Confirm both ZIP files and `SHA256SUMS.txt` exist in `dist/`.
- [ ] Confirm the two ZIP hashes match the checksum file and the recorded
      release notes.
- [ ] Confirm the accepted Edge validation record and deferred non-blocking
      checks in `MANUAL_VALIDATION.md` are still accurate.
- [ ] Review `RELEASE_NOTES_1.1.0.md` for accuracy.
- [ ] Obtain explicit approval before committing, tagging, pushing, signing, or
      publishing.

## Preconditions

- Use Node.js 20 or newer.
- Confirm `manifest.json` and `package.json` contain the same release version.
- Complete the applicable items in `MANUAL_VALIDATION.md`.
- Ensure no downloaded Jackrabbit CSV/JSON files or other operational data are
  present in the repository.

## Validate and package

Run the complete release gate:

```sh
npm run release:check
```

This command:

1. runs all automated tests;
2. syntax-checks runtime and release scripts;
3. builds the release twice in isolated temporary directories and verifies
   byte-for-byte reproducibility;
4. builds the final artifacts in `dist/`;
5. verifies exact ZIP contents, CRCs, central-directory metadata, source-file
   bytes, manifest permissions/assets, and SHA-256 checksums.

To create artifacts without the full gate, run `npm run package`. Do this only
after a successful `npm run release:check` for the same source and version.

## Generated files

- `dist/jackrabbit-exporter-<version>-chromium.zip`
- `dist/jackrabbit-exporter-<version>-firefox.zip`
- `dist/SHA256SUMS.txt`

The packages contain only the explicit allowlist in
`scripts/release-config.mjs`: runtime JavaScript/HTML, `manifest.json`, icons,
the license, and the privacy notice. Tests, development scripts, repository
metadata, documentation not needed at runtime, CSV files, and desktop handoff
bundles are excluded.

Text files are normalized to LF, entries are sorted, timestamps are fixed to
1980-01-01, permissions are fixed, and files use the ZIP stored method. These
choices avoid OS-, checkout-, clock-, and compression-library-dependent bytes.

## Manual artifact check

- Compare each artifact hash with `dist/SHA256SUMS.txt`.
- Load the Chromium ZIP after extracting it into a clean temporary directory,
  or submit the ZIP through the intended store validation flow.
- Load the Firefox ZIP as a temporary add-on or submit it through Mozilla's
  validation/signing flow.
- Perform only the privacy-safe smoke tests documented in
  `MANUAL_VALIDATION.md`.

Generated `dist/` files are ignored by Git. Do not commit release archives or
operational exports. Committing, tagging, pushing, signing, and publishing are
separate explicit actions and are not performed by the packaging command.
