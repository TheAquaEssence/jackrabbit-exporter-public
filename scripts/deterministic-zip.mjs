import { readFile } from "node:fs/promises";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY_UNIX = (3 << 8) | VERSION_NEEDED;
const FIXED_DOS_TIME = 0;
const FIXED_DOS_DATE = (1 << 5) | 1; // 1980-01-01
const REGULAR_FILE_MODE = 0o100644 << 16;

const crcTable = new Uint32Array(256);
for (let n = 0; n < crcTable.length; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[n] = value >>> 0;
}

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function normalizedEntry(entry) {
  const name = String(entry.name || "").replaceAll("\\", "/");
  if (!name || name.startsWith("/") || name.includes("../") || name.includes("\0")) {
    throw new Error(`Unsafe ZIP entry name: ${entry.name}`);
  }
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
  if (data.length > 0xffffffff) throw new Error(`ZIP entry is too large: ${name}`);
  return { name, data };
}

/** Create a stable ZIP using stored entries, fixed timestamps, and sorted names. */
export function createDeterministicZip(inputEntries) {
  const entries = inputEntries.map(normalizedEntry)
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const names = new Set();
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`Duplicate ZIP entry: ${entry.name}`);
    names.add(entry.name);

    const name = Buffer.from(entry.name, "utf8");
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(STORE_METHOD, 8);
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIRECTORY_HEADER, 0);
    central.writeUInt16LE(VERSION_MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(STORE_METHOD, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(REGULAR_FILE_MODE >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);

    localOffset += local.length + name.length + entry.data.length;
  }

  if (entries.length > 0xffff) throw new Error("ZIP64 is not supported");
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** Read the simple stored-entry ZIP format emitted above for release checks. */
export function readStoredZipEntries(zip) {
  const entries = new Map();
  const localMetadata = new Map();
  let offset = 0;
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === LOCAL_FILE_HEADER) {
    const localHeaderOffset = offset;
    if (offset + 30 > zip.length) throw new Error("Truncated ZIP local header");
    const flags = zip.readUInt16LE(offset + 6);
    const method = zip.readUInt16LE(offset + 8);
    const checksum = zip.readUInt32LE(offset + 14);
    const compressedSize = zip.readUInt32LE(offset + 18);
    const uncompressedSize = zip.readUInt32LE(offset + 22);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    if (!(flags & UTF8_FLAG) || method !== STORE_METHOD || compressedSize !== uncompressedSize) {
      throw new Error("Unexpected ZIP encoding");
    }
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zip.length) throw new Error("Truncated ZIP entry");
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const data = Buffer.from(zip.subarray(dataStart, dataEnd));
    if (entries.has(name)) throw new Error(`Duplicate ZIP entry: ${name}`);
    if (crc32(data) !== checksum) throw new Error(`CRC mismatch for ZIP entry: ${name}`);
    entries.set(name, data);
    localMetadata.set(name, {
      checksum,
      size: data.length,
      offset: localHeaderOffset,
    });
    offset = dataEnd;
  }
  if (entries.size === 0) throw new Error("ZIP contains no files");

  const centralOffset = offset;
  const centralNames = [];
  while (offset + 4 <= zip.length && zip.readUInt32LE(offset) === CENTRAL_DIRECTORY_HEADER) {
    if (offset + 46 > zip.length) throw new Error("Truncated ZIP central-directory header");
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const checksum = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeaderOffset = zip.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const end = nameStart + nameLength + extraLength + commentLength;
    if (end > zip.length) throw new Error("Truncated ZIP central-directory entry");
    const name = zip.subarray(nameStart, nameStart + nameLength).toString("utf8");
    const local = localMetadata.get(name);
    if (!local || !(flags & UTF8_FLAG) || method !== STORE_METHOD) {
      throw new Error(`Unexpected ZIP central-directory entry: ${name}`);
    }
    if (
      checksum !== local.checksum ||
      compressedSize !== local.size ||
      uncompressedSize !== local.size ||
      localHeaderOffset !== local.offset
    ) {
      throw new Error(`ZIP directory mismatch for entry: ${name}`);
    }
    centralNames.push(name);
    offset = end;
  }

  if (offset + 22 !== zip.length || zip.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY) {
    throw new Error("Missing or malformed ZIP end record");
  }
  const diskEntries = zip.readUInt16LE(offset + 8);
  const totalEntries = zip.readUInt16LE(offset + 10);
  const centralSize = zip.readUInt32LE(offset + 12);
  const recordedCentralOffset = zip.readUInt32LE(offset + 16);
  const commentLength = zip.readUInt16LE(offset + 20);
  if (
    diskEntries !== entries.size ||
    totalEntries !== entries.size ||
    centralSize !== offset - centralOffset ||
    recordedCentralOffset !== centralOffset ||
    commentLength !== 0 ||
    centralNames.join("\0") !== [...entries.keys()].join("\0")
  ) {
    throw new Error("ZIP end record does not match its directory");
  }
  return entries;
}

export async function readZipFileEntries(filename) {
  return readStoredZipEntries(await readFile(filename));
}
