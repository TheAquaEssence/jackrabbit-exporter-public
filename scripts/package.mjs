import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDeterministicZip } from "./deterministic-zip.mjs";
import {
  RELEASE_FILES,
  RELEASE_TARGETS,
  TEXT_RELEASE_FILES,
  artifactFilename,
} from "./release-config.mjs";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function normalizeText(data) {
  return Buffer.from(data.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
}

export async function readReleaseEntries(root = projectRoot) {
  const entries = [];
  for (const name of RELEASE_FILES) {
    const absolute = path.join(root, ...name.split("/"));
    let data = await readFile(absolute);
    if (TEXT_RELEASE_FILES.has(name)) data = normalizeText(data);
    if (data.length === 0) throw new Error(`Release file is empty: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export async function readVersion(root = projectRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (manifest.version !== packageJson.version) {
    throw new Error(`Version mismatch: manifest=${manifest.version}, package=${packageJson.version}`);
  }
  return manifest.version;
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export async function buildRelease(outputDir = path.join(projectRoot, "dist")) {
  const version = await readVersion();
  const zip = createDeterministicZip(await readReleaseEntries());
  await mkdir(outputDir, { recursive: true });

  const artifacts = [];
  for (const target of RELEASE_TARGETS) {
    const filename = artifactFilename(version, target);
    const absolute = path.join(outputDir, filename);
    await writeFile(absolute, zip);
    artifacts.push({ target, filename, absolute, sha256: sha256(zip), size: zip.length });
  }

  const checksumText = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.filename}`)
    .join("\n") + "\n";
  const checksumFile = path.join(outputDir, "SHA256SUMS.txt");
  await writeFile(checksumFile, checksumText, "utf8");
  return { version, outputDir, artifacts, checksumFile };
}

async function main() {
  const result = await buildRelease();
  console.log(`Packaged Jackrabbit Exporter ${result.version}:`);
  for (const artifact of result.artifacts) {
    console.log(`- ${path.relative(projectRoot, artifact.absolute)} (${artifact.size} bytes)`);
    console.log(`  SHA-256 ${artifact.sha256}`);
  }
  console.log(`- ${path.relative(projectRoot, result.checksumFile)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
