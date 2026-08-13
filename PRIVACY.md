# Privacy

Jackrabbit Exporter processes student, instructor, class, enrollment, and
historical pairing data visible to the signed-in Jackrabbit Class user. This
may include personal or sensitive information.

## Data access

The extension runs only on configured Jackrabbit Class domains. When the user
starts an export, it reads the visible page and may request related Jackrabbit
pages or grid endpoints using the user's existing authenticated browser
session.

## Data storage and transfer

- Captured records are buffered in browser extension session storage when the
  browser supports it, with local extension storage as a compatibility fallback.
- The extension does not collect Jackrabbit credentials.
- The extension does not send captured records to Aqua Essence or any other
  third-party service.
- Data leaves the extension only when the user explicitly downloads an
  individual CSV or the JSON bundle containing the four CSV payloads.
- **Clear buffer** resets students, classes, staff, pairings, capture counters,
  and bulk-progress state in memory and extension storage.

Downloaded CSV and JSON files are outside the extension's control. Store,
share, import, and delete them according to the organization's privacy and
retention policies. The extension does not write extracted record contents or
authenticated record URLs to its diagnostic console output.

The exporter leaves unavailable fields blank. It does not infer swimmer RSS
levels or medical flags, and it does not import or present Aqua Essence's
curated instructor profiles as authoritative Jackrabbit records.

## Permissions

- `storage` persists the export buffer across extension service-worker
  restarts.
- Host access is limited to HTTPS subdomains of `jackrabbitclass.com` and
  `jackrabbittech.com` so the content script can read and export Jackrabbit
  data.
