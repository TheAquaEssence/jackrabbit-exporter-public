# Contributing

## Development checks

Use Node.js 20 or newer and run:

```sh
npm test
npm run check
npm run release:check
```

Run `npm run release:check` before proposing a release. Generated archives stay
in the ignored `dist/` directory and must not be committed. If a new runtime
asset is added, update the explicit allowlist in `scripts/release-config.mjs`
and its tests.

Reload the unpacked extension in each affected browser after changing runtime
behavior. Browser testing must use an authorized account and synthetic or
otherwise approved test records.

## Privacy

Never commit or attach real Jackrabbit exports, screenshots containing
operational records, credentials, session information, student details, staff
details, or medical notes. Use synthetic fixtures with invented identifiers.

## CSV compatibility

Changes to the exported headers are integration-contract changes. Update the
CSV-builder tests and coordinate the corresponding Aqua Essence importer
change before merging them.

## Commits and pull requests

Keep changes focused and explain which Jackrabbit page layout and browser were
tested. Report security issues privately as described in `SECURITY.md`.
