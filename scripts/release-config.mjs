export const RELEASE_BASENAME = "jackrabbit-exporter";

// Explicit allowlist: adding a runtime file requires an intentional release
// review. Development files, tests, fixtures, and exported operational data
// cannot enter a package through recursive directory traversal.
export const RELEASE_FILES = Object.freeze([
  "LICENSE",
  "PRIVACY.md",
  "background.js",
  "content.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "manifest.json",
  "popup.html",
  "popup.js",
  "utils/csv_builder.js",
]);

export const TEXT_RELEASE_FILES = new Set(
  RELEASE_FILES.filter((file) =>
    file === "LICENSE" || /\.(?:html|js|json|md)$/i.test(file)
  )
);

export const RELEASE_TARGETS = Object.freeze(["chromium", "firefox"]);

export function artifactFilename(version, target) {
  if (!RELEASE_TARGETS.includes(target)) {
    throw new Error(`Unknown release target: ${target}`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid extension version: ${version}`);
  }
  return `${RELEASE_BASENAME}-${version}-${target}.zip`;
}
