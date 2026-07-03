#!/usr/bin/env node
/**
 * Download pinned codebase-memory UI variant for a target platform.
 *
 * Upstream GitHub release assets still publish as `codebase-memory-mcp-*`;
 * this script renames the extracted binary to Loom's sidecar name `codebase-memory-*`.
 *
 * Usage:
 *   node scripts/fetch-cbm-sidecar.mjs [--force] [--target <triple>]
 *
 * Target resolution (first match wins):
 *   1. --target <triple>   CLI flag (highest priority)
 *   2. TAURI_ENV_TARGET_TRIPLE  env var (set by Tauri CLI before beforeBuildCommand)
 *   3. Auto-detect current platform
 *
 * --target <triple>   Override the target triple (e.g. aarch64-pc-windows-msvc).
 *                     Useful for CI cross-compilation builds.
 *
 * Examples:
 *   # Current platform
 *   npm run fetch:cbm
 *
 *   # CI: cross-compile to aarch64 Windows
 *   npm run fetch:cbm -- --target aarch64-pc-windows-msvc
 *
 *   # CI: rely on TAURI_ENV_TARGET_TRIPLE (set by tauri build --target)
 *   TAURI_ENV_TARGET_TRIPLE=x86_64-unknown-linux-gnu npm run fetch:cbm
 */

import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { chmodSync, renameSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Read version from single source of truth: src-tauri/cbm-version.json
const versionJson = JSON.parse(
  readFileSync(path.join(ROOT, 'src-tauri', 'cbm-version.json'), 'utf-8'),
);
const CBM_VERSION = versionJson.version;
const OUT_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const FORCE = process.argv.includes('--force');

/** Upstream release asset prefix (github.com/DeusData/codebase-memory-mcp) */
const UPSTREAM_RELEASE_PREFIX = 'codebase-memory-mcp';
/** Bundled Tauri sidecar prefix shipped with Loom */
const SIDECAR_PREFIX = 'codebase-memory';

// ── --target parsing ──

function parseTargetFlag() {
  const idx = process.argv.indexOf('--target');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  // Also support --target=<triple> form
  const eqArg = process.argv.find((a) => a.startsWith('--target='));
  if (eqArg) return eqArg.slice('--target='.length);
  return null;
}

const EXPLICIT_TARGET = parseTargetFlag();

// ── Tauri env var fallback ──
// Tauri CLI sets TAURI_ENV_TARGET_TRIPLE before running beforeBuildCommand
// when `tauri build --target <triple>` is used. CI can also set it manually.
const ENV_TARGET = process.env.TAURI_ENV_TARGET_TRIPLE || null;

// ── Target triple → platform/arch mapping ──

/**
 * @typedef {{ archive: string, binary: string, extract: 'zip' | 'tar', checksumKey: string, sidecarName: string }} TargetInfo
 */

/** Map a Rust target triple to download info. Returns null for unsupported triples. */
/** @param {string} triple @returns {TargetInfo | null} */
function targetInfoFromTriple(triple) {
  // Parse: <arch>-<vendor>-<os>-<env>
  // Common triples:
  //   x86_64-pc-windows-msvc
  //   aarch64-pc-windows-msvc
  //   x86_64-apple-darwin
  //   aarch64-apple-darwin
  //   x86_64-unknown-linux-gnu
  //   aarch64-unknown-linux-gnu

  const isWindows = triple.includes('windows');
  const isDarwin = triple.includes('apple') || triple.includes('darwin') || triple.includes('macos');
  const isLinux = triple.includes('linux');
  const isArm64 = triple.startsWith('aarch64') || triple.startsWith('arm64');
  const isX64 = triple.startsWith('x86_64') || triple.startsWith('amd64');

  const arch = isArm64 ? 'arm64' : isX64 ? 'x64' : null;
  if (!arch) return null;

  if (isWindows) {
    return {
      archive: `${UPSTREAM_RELEASE_PREFIX}-ui-windows-${isArm64 ? 'arm64' : 'amd64'}.zip`,
      binary: `${UPSTREAM_RELEASE_PREFIX}.exe`,
      extract: 'zip',
      checksumKey: `${UPSTREAM_RELEASE_PREFIX}-ui-windows-${isArm64 ? 'arm64' : 'amd64'}.zip`,
      sidecarName: `${triple.includes('aarch64') ? 'aarch64' : 'x86_64'}-pc-windows-msvc.exe`,
    };
  }
  if (isDarwin) {
    return {
      archive: `${UPSTREAM_RELEASE_PREFIX}-ui-darwin-${isArm64 ? 'arm64' : 'amd64'}.tar.gz`,
      binary: UPSTREAM_RELEASE_PREFIX,
      extract: 'tar',
      checksumKey: `${UPSTREAM_RELEASE_PREFIX}-ui-darwin-${isArm64 ? 'arm64' : 'amd64'}.tar.gz`,
      sidecarName: `${isArm64 ? 'aarch64' : 'x86_64'}-apple-darwin`,
    };
  }
  if (isLinux) {
    return {
      archive: `${UPSTREAM_RELEASE_PREFIX}-ui-linux-${isArm64 ? 'arm64' : 'amd64'}.tar.gz`,
      binary: UPSTREAM_RELEASE_PREFIX,
      extract: 'tar',
      checksumKey: `${UPSTREAM_RELEASE_PREFIX}-ui-linux-${isArm64 ? 'arm64' : 'amd64'}.tar.gz`,
      sidecarName: `${isArm64 ? 'aarch64' : 'x86_64'}-unknown-linux-gnu`,
    };
  }
  return null;
}

/** Detect the current platform's target triple. */
function detectTargetTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    return arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  }
  return null;
}

const TARGET_TRIPLE = EXPLICIT_TARGET ?? ENV_TARGET ?? detectTargetTriple();

// ── Legacy platform-arch key for backward compat ──
const PLATFORM = process.platform;
const ARCH = process.arch;

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  if (!res.body) {
    throw new Error(`Empty body: ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function fetchChecksumMap(baseUrl) {
  const checksumUrl = `${baseUrl}/checksums.txt`;
  try {
    const res = await fetch(checksumUrl);
    if (!res.ok) {
      console.warn(`[fetch-cbm] checksums.txt unavailable (${res.status}); skip verification`);
      return new Map();
    }
    const text = await res.text();
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (match) {
        map.set(match[2].trim(), match[1].toLowerCase());
      }
    }
    return map;
  } catch (err) {
    console.warn(`[fetch-cbm] checksums.txt fetch failed (${err.code ?? err.message}); skip verification`);
    return new Map();
  }
}

function verifyChecksum(filePath, expected, label) {
  if (!expected) return;
  const actual = sha256File(filePath);
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
  console.log(`[fetch-cbm] Verified ${label} checksum`);
}

async function extractZip(archivePath, binaryName, outPath) {
  const { execFileSync } = await import('node:child_process');
  const tmpDir = path.join(OUT_DIR, '.extract-tmp');
  mkdirSync(tmpDir, { recursive: true });
  execFileSync('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
  ]);
  const extracted = path.join(tmpDir, binaryName);
  if (!existsSync(extracted)) {
    throw new Error(`Binary not found after extract: ${extracted}`);
  }
  renameSync(extracted, outPath);
}

async function extractTar(archivePath, binaryName, outPath) {
  const { execFileSync } = await import('node:child_process');
  const tmpDir = path.join(OUT_DIR, '.extract-tmp');
  mkdirSync(tmpDir, { recursive: true });
  execFileSync('tar', ['xzf', archivePath, '-C', tmpDir]);
  const extracted = path.join(tmpDir, binaryName);
  if (!existsSync(extracted)) {
    throw new Error(`Binary not found after extract: ${extracted}`);
  }
  renameSync(extracted, outPath);
  chmodSync(outPath, 0o755);
}

async function main() {
  if (!TARGET_TRIPLE) {
    console.error(`[fetch-cbm] Unsupported platform ${PLATFORM}-${ARCH}; cannot determine target triple.`);
    process.exitCode = 1;
    return;
  }

  const target = targetInfoFromTriple(TARGET_TRIPLE);
  if (!target) {
    console.error(`[fetch-cbm] Unsupported target triple: ${TARGET_TRIPLE}`);
    process.exitCode = 1;
    return;
  }

  const source = EXPLICIT_TARGET ? 'explicit' : ENV_TARGET ? 'env' : 'detected';
  console.log(`[fetch-cbm] Target triple: ${TARGET_TRIPLE} (${source})`);

  mkdirSync(OUT_DIR, { recursive: true });
  // Tauri sidecar naming: codebase-memory-{triple}{.exe?}
  const sidecarName = `${SIDECAR_PREFIX}-${target.sidecarName}`;
  const outPath = path.join(OUT_DIR, sidecarName);
  const baseUrl = `https://github.com/DeusData/codebase-memory-mcp/releases/download/v${CBM_VERSION}`;
  const checksums = await fetchChecksumMap(baseUrl);

  if (existsSync(outPath) && !FORCE) {
    const expected = checksums.get(sidecarName) ?? checksums.get(target.binary);
    if (expected) {
      verifyChecksum(outPath, expected, sidecarName);
    }
    console.log(`[fetch-cbm] Sidecar already exists: ${outPath}`);
    return;
  }

  const archiveUrl = `${baseUrl}/${target.archive}`;
  const archivePath = path.join(OUT_DIR, target.archive);

  console.log(`[fetch-cbm] Downloading ${archiveUrl}`);
  await download(archiveUrl, archivePath);
  verifyChecksum(archivePath, checksums.get(target.checksumKey), target.archive);

  const tmpOut = path.join(OUT_DIR, target.binary);
  if (target.extract === 'zip') {
    await extractZip(archivePath, target.binary, tmpOut);
  } else {
    await extractTar(archivePath, target.binary, tmpOut);
  }

  renameSync(tmpOut, outPath);
  if (PLATFORM !== 'win32') {
    chmodSync(outPath, 0o755);
  }

  try {
    unlinkSync(archivePath);
  } catch {
    // ignore cleanup errors
  }

  const expectedBinary = checksums.get(sidecarName) ?? checksums.get(target.binary);
  verifyChecksum(outPath, expectedBinary, sidecarName);
  const hash = sha256File(outPath);
  console.log(`[fetch-cbm] Installed ${outPath} (sha256: ${hash.slice(0, 16)}…)`);
}

main().catch((err) => {
  console.error('[fetch-cbm]', err);
  process.exitCode = 1;
});
