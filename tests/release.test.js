import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeterministicZip,
  readStoredZipEntries,
} from "../scripts/deterministic-zip.mjs";
import { normalizeText } from "../scripts/package.mjs";
import {
  RELEASE_FILES,
  artifactFilename,
} from "../scripts/release-config.mjs";

test("deterministic ZIP output is independent of input order", () => {
  const entries = [
    { name: "z-last.txt", data: Buffer.from("last") },
    { name: "a-first.txt", data: Buffer.from("first") },
  ];
  const forward = createDeterministicZip(entries);
  const reverse = createDeterministicZip([...entries].reverse());

  assert.deepEqual(forward, reverse);
  const unpacked = readStoredZipEntries(forward);
  assert.deepEqual([...unpacked.keys()], ["a-first.txt", "z-last.txt"]);
  assert.equal(unpacked.get("a-first.txt").toString("utf8"), "first");
});

test("ZIP validation rejects a central-directory mismatch", () => {
  const zip = createDeterministicZip([{ name: "safe.txt", data: Buffer.from("synthetic") }]);
  const corrupted = Buffer.from(zip);
  const centralSignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  const centralOffset = corrupted.indexOf(centralSignature);
  assert.ok(centralOffset >= 0);
  corrupted.writeUInt32LE(0, centralOffset + 16);
  assert.throws(() => readStoredZipEntries(corrupted), /directory mismatch/);
});

test("release text normalization makes Windows and Unix checkouts equivalent", () => {
  assert.deepEqual(normalizeText(Buffer.from("one\r\ntwo\rthree\n")), Buffer.from("one\ntwo\nthree\n"));
  assert.deepEqual(normalizeText(Buffer.from("\uFEFFmanifest")), Buffer.from("manifest"));
});

test("release artifacts use versioned target names and an explicit safe allowlist", () => {
  assert.equal(artifactFilename("1.1.0", "chromium"), "jackrabbit-exporter-1.1.0-chromium.zip");
  assert.equal(artifactFilename("1.1.0", "firefox"), "jackrabbit-exporter-1.1.0-firefox.zip");
  assert.throws(() => artifactFilename("not-a-version", "chromium"), /Invalid extension version/);
  assert.throws(() => artifactFilename("1.1.0", "unknown"), /Unknown release target/);
  assert.ok(RELEASE_FILES.includes("manifest.json"));
  assert.ok(RELEASE_FILES.includes("utils/csv_builder.js"));
  assert.equal(RELEASE_FILES.some((name) => /tests|\.csv$|AGENTS\.md/.test(name)), false);
});
