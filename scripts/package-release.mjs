/**
 * @file package-release.mjs
 * @description Builds the Chrome Web Store upload archive from an existing dist/ build.
 *
 * Usage: npm run build && npm run package
 * Output: release/anilist-ultimate-<version>.zip
 *
 * The manifest stored in the archive has its `key` removed: the key only pins the
 * extension ID for local development, and the store assigns its own ID. The
 * dist/manifest.json file itself is never modified. The archive is reproducible:
 * entries are sorted and every entry uses the same fixed DOS timestamp.
 */

import { deflateRawSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const RELEASE_DIR = join(ROOT, 'release');

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;
const UTF8_NAMES_FLAG = 0x0800;
const METHOD_DEFLATE = 8;
const VERSION_NEEDED = 20;
const DOS_TIME_MIDNIGHT = 0;
const DOS_DATE_1980_01_01 = (0 << 9) | (1 << 5) | 1;
const EXCLUDED_FILE = /\.map$/;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readReleaseVersion() {
  const distManifest = join(DIST, 'manifest.json');
  if (!existsSync(distManifest)) throw new Error('dist/manifest.json not found: run npm run build first');
  const versions = {
    'package.json': readJson(join(ROOT, 'package.json')).version,
    'public/manifest.json': readJson(join(ROOT, 'public', 'manifest.json')).version,
    'dist/manifest.json': readJson(distManifest).version,
  };
  if (new Set(Object.values(versions)).size !== 1) {
    throw new Error(`Version mismatch between manifests: ${JSON.stringify(versions)}`);
  }
  return versions['dist/manifest.json'];
}

/** Returns the packaged manifest text: a copy of dist/manifest.json without `key`. */
function releaseManifestText() {
  const { key: _devKey, ...manifest } = readJson(join(DIST, 'manifest.json'));
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Recursively lists dist/ files as forward-slash paths, skipping dot entries and source maps. */
function collectFiles(directory = DIST, base = DIST) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(absolute, base);
    if (!entry.isFile() || EXCLUDED_FILE.test(entry.name)) return [];
    return [relative(base, absolute).split(sep).join('/')];
  }).sort();
}

function readArchiveFiles() {
  return collectFiles().map((name) => ({
    name,
    data: name === 'manifest.json' ? Buffer.from(releaseManifestText(), 'utf8') : readFileSync(join(DIST, name)),
  }));
}

/** Encodes one entry as a local file header followed by its name and deflated data. */
function encodeEntry(name, data) {
  const nameBytes = Buffer.from(name, 'utf8');
  const compressed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_NAMES_FLAG, 6);
  header.writeUInt16LE(METHOD_DEFLATE, 8);
  header.writeUInt16LE(DOS_TIME_MIDNIGHT, 10);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  return {
    nameBytes,
    crc,
    compressedSize: compressed.length,
    uncompressedSize: data.length,
    local: Buffer.concat([header, nameBytes, compressed]),
  };
}

/** Central directory record for an encoded entry located at `localOffset`. */
function encodeCentralRecord(entry, localOffset) {
  const header = Buffer.alloc(CENTRAL_HEADER_SIZE);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(VERSION_NEEDED, 6);
  header.writeUInt16LE(UTF8_NAMES_FLAG, 8);
  header.writeUInt16LE(METHOD_DEFLATE, 10);
  header.writeUInt16LE(DOS_TIME_MIDNIGHT, 12);
  header.writeUInt16LE(DOS_DATE_1980_01_01, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt32LE(localOffset, 42);
  return Buffer.concat([header, entry.nameBytes]);
}

function encodeEndRecord(entryCount, centralSize, centralOffset) {
  const record = Buffer.alloc(END_RECORD_SIZE);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(entryCount, 8);
  record.writeUInt16LE(entryCount, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

function buildZip(files) {
  const encoded = files.map(({ name, data }) => encodeEntry(name, data));
  let offset = 0;
  const centralRecords = encoded.map((entry) => {
    const record = encodeCentralRecord(entry, offset);
    offset += entry.local.length;
    return record;
  });
  const centralDirectory = Buffer.concat(centralRecords);
  const endRecord = encodeEndRecord(encoded.length, centralDirectory.length, offset);
  return Buffer.concat([...encoded.map((entry) => entry.local), centralDirectory, endRecord]);
}

function main() {
  const version = readReleaseVersion();
  const files = readArchiveFiles();
  if (files.length === 0) throw new Error('dist/ contains no packageable files');
  const archive = buildZip(files);
  mkdirSync(RELEASE_DIR, { recursive: true });
  const output = join(RELEASE_DIR, `anilist-ultimate-${version}.zip`);
  writeFileSync(output, archive);
  console.log(`Packaged ${files.length} files, ${archive.length} bytes -> ${relative(ROOT, output)}`);
}

try {
  main();
} catch (error) {
  console.error(`Packaging failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
