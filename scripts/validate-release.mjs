import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readStoredZipEntries } from "./deterministic-zip.mjs";
import { buildRelease, normalizeText, projectRoot, sha256 } from "./package.mjs";
import { RELEASE_FILES, TEXT_RELEASE_FILES } from "./release-config.mjs";

const EXPECTED_PERMISSIONS = ["storage"];
const EXPECTED_HOSTS = [
  "https://*.jackrabbitclass.com/*",
  "https://*.jackrabbittech.com/*",
];

async function expectedFileBytes(name) {
  const data = await readFile(path.join(projectRoot, ...name.split("/")));
  return TEXT_RELEASE_FILES.has(name) ? normalizeText(data) : data;
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(path.join(projectRoot, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, packageJson.version);
  assert.deepEqual(manifest.permissions, EXPECTED_PERMISSIONS);
  assert.deepEqual(manifest.host_permissions, EXPECTED_HOSTS);
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.background.scripts, ["background.js"]);
  assert.equal(manifest.action.default_popup, "popup.html");
  assert.equal(manifest.browser_specific_settings.gecko.id, "jackrabbit-exporter@aqua-essence");

  const referencedAssets = new Set([
    manifest.background.service_worker,
    ...manifest.background.scripts,
    manifest.action.default_popup,
    ...manifest.content_scripts.flatMap((script) => script.js),
    ...Object.values(manifest.icons),
    "popup.js",
    "utils/csv_builder.js",
  ]);
  for (const asset of referencedAssets) {
    assert.ok(RELEASE_FILES.includes(asset), `Runtime asset is missing from release allowlist: ${asset}`);
  }
  return manifest;
}

async function validateArtifact(artifact) {
  const zip = await readFile(artifact.absolute);
  assert.equal(sha256(zip), artifact.sha256);
  const entries = readStoredZipEntries(zip);
  assert.deepEqual(
    [...entries.keys()],
    [...RELEASE_FILES].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  );

  for (const name of RELEASE_FILES) {
    assert.deepEqual(entries.get(name), await expectedFileBytes(name), `${name} differs from source`);
  }

  const forbidden = [...entries.keys()].filter((name) =>
    /(^|\/)(?:\.git|\.github|tests?|scripts?|dist)(?:\/|$)/i.test(name) ||
    /(?:aqua_essence_jackrabbit_export\.json|\.csv$)/i.test(name)
  );
  assert.deepEqual(forbidden, [], `Forbidden package entries: ${forbidden.join(", ")}`);

  const packagedManifest = JSON.parse(entries.get("manifest.json").toString("utf8"));
  assert.equal(packagedManifest.version, (await validateManifest()).version);
}

async function main() {
  await validateManifest();

  const firstDir = await mkdtemp(path.join(os.tmpdir(), "jackrabbit-release-a-"));
  const secondDir = await mkdtemp(path.join(os.tmpdir(), "jackrabbit-release-b-"));
  try {
    const first = await buildRelease(firstDir);
    const second = await buildRelease(secondDir);

    assert.deepEqual(
      first.artifacts.map(({ filename, sha256: hash, size }) => ({ filename, hash, size })),
      second.artifacts.map(({ filename, sha256: hash, size }) => ({ filename, hash, size })),
      "Repeated release builds are not byte-for-byte reproducible"
    );
  } finally {
    for (const directory of [firstDir, secondDir]) {
      const resolved = path.resolve(directory);
      const tempRoot = path.resolve(os.tmpdir());
      if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("jackrabbit-release-")) {
        throw new Error(`Refusing to remove unexpected temporary directory: ${resolved}`);
      }
      await rm(resolved, { recursive: true });
    }
  }

  const release = await buildRelease();
  for (const artifact of release.artifacts) await validateArtifact(artifact);

  const expectedChecksums = release.artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.filename}`)
    .join("\n") + "\n";
  assert.equal(await readFile(release.checksumFile, "utf8"), expectedChecksums);

  console.log(`Release validation passed for ${release.version}.`);
  for (const artifact of release.artifacts) {
    console.log(`- ${artifact.filename}: ${artifact.sha256}`);
  }
}

await main();
