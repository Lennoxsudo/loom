#!/usr/bin/env node
/**
 * Download whisper.cpp CLI binary + runtime DLLs + multilingual model.
 *
 * Usage:
 *   node scripts/fetch-whisper-sidecar.mjs [--force] [--target <triple>] [--model-only] [--binary-only]
 *
 * Output:
 *   src-tauri/binaries/whisper-cli-{triple}{.exe?}
 *   src-tauri/resources/whisper/runtime/*   (Windows DLLs next to CLI needs)
 *   src-tauri/resources/whisper/{model from whisper-version.json}
 */

import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  copyFileSync,
  chmodSync,
} from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionJson = JSON.parse(
  readFileSync(path.join(ROOT, 'src-tauri', 'whisper-version.json'), 'utf-8'),
);
const WHISPER_VERSION = versionJson.version;
const MODEL_NAME = versionJson.model || 'ggml-tiny.bin';
const MODEL_URL =
  versionJson.modelUrl ||
  `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}`;

const BIN_DIR = path.join(ROOT, 'src-tauri', 'binaries');
const MODEL_DIR = path.join(ROOT, 'src-tauri', 'resources', 'whisper');
const RUNTIME_DIR = path.join(MODEL_DIR, 'runtime');
const FORCE = process.argv.includes('--force');
const MODEL_ONLY = process.argv.includes('--model-only');
const BINARY_ONLY = process.argv.includes('--binary-only');

function parseTargetFlag() {
  const idx = process.argv.indexOf('--target');
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  const eqArg = process.argv.find((a) => a.startsWith('--target='));
  if (eqArg) return eqArg.slice('--target='.length);
  return null;
}

const EXPLICIT_TARGET = parseTargetFlag();
const ENV_TARGET = process.env.TAURI_ENV_TARGET_TRIPLE || null;

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

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Download failed ${res.status}: ${url}`);
  }
  if (!res.body) {
    throw new Error(`Empty body: ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function listFilesRecursive(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function findBestBinary(dir, preferredNames) {
  const files = listFilesRecursive(dir);
  /** @type {{ path: string, size: number, rank: number }[]} */
  const matches = [];
  for (const full of files) {
    const base = path.basename(full);
    const rank = preferredNames.indexOf(base);
    if (rank === -1) continue;
    const size = statSync(full).size;
    // Official zip also contains 27KB deprecation stubs with the same names.
    if (size < 100_000) continue;
    matches.push({ path: full, size, rank });
  }
  matches.sort((a, b) => a.rank - b.rank || b.size - a.size);
  return matches[0]?.path ?? null;
}

function extractZip(archivePath, tmpDir) {
  mkdirSync(tmpDir, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force`,
    ]);
    return;
  }
  execFileSync('unzip', ['-o', archivePath, '-d', tmpDir]);
}

/**
 * @param {string} triple
 * @returns {{ archive: string, extract: 'zip' | 'tar', binaryNames: string[], sidecarName: string, copyRuntime: boolean } | null}
 */
function targetInfoFromTriple(triple) {
  const isWindows = triple.includes('windows');
  const isDarwin = triple.includes('apple') || triple.includes('darwin');
  const isLinux = triple.includes('linux');
  const isArm64 = triple.startsWith('aarch64') || triple.startsWith('arm64');
  const isX64 = triple.startsWith('x86_64') || triple.startsWith('amd64');
  if (!isArm64 && !isX64) return null;

  if (isWindows) {
    if (isArm64) return null;
    return {
      archive: 'whisper-bin-x64.zip',
      extract: 'zip',
      binaryNames: ['whisper-cli.exe', 'main.exe'],
      sidecarName: `whisper-cli-${triple}.exe`,
      copyRuntime: true,
    };
  }
  if (isDarwin || isLinux) {
    // Official prebuilt CPU archives are currently Windows-focused for this pin.
    return null;
  }
  return null;
}

function copyWindowsRuntime(releaseDir) {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const requiredExact = ['whisper.dll', 'ggml.dll', 'ggml-base.dll'];
  const files = readdirSync(releaseDir);
  for (const name of files) {
    const full = path.join(releaseDir, name);
    if (!statSync(full).isFile()) continue;
    const lower = name.toLowerCase();
    const keep =
      requiredExact.includes(name) ||
      /^ggml-cpu-.*\.dll$/i.test(name) ||
      lower === 'whisper-cli.exe';
    // Keep CLI copy inside runtime so DLL search always succeeds when cwd=runtime.
    if (!keep) continue;
    copyFileSync(full, path.join(RUNTIME_DIR, name));
  }
  for (const name of requiredExact) {
    if (!existsSync(path.join(RUNTIME_DIR, name))) {
      throw new Error(`Missing required runtime file after extract: ${name}`);
    }
  }
  console.log(`[fetch-whisper] Runtime DLLs installed under ${RUNTIME_DIR}`);
}

async function ensureModel() {
  mkdirSync(MODEL_DIR, { recursive: true });
  const outPath = path.join(MODEL_DIR, MODEL_NAME);
  if (existsSync(outPath) && !FORCE) {
    const size = statSync(outPath).size;
    if (size > 1_000_000) {
      console.log(`[fetch-whisper] Model already exists: ${outPath} (${size} bytes)`);
      return outPath;
    }
  }
  console.log(`[fetch-whisper] Downloading model ${MODEL_URL}`);
  const tmp = `${outPath}.download`;
  await download(MODEL_URL, tmp);
  renameSync(tmp, outPath);
  console.log(
    `[fetch-whisper] Installed model ${outPath} (sha256: ${sha256File(outPath).slice(0, 16)}…)`,
  );
  return outPath;
}

async function ensureBinary() {
  if (!TARGET_TRIPLE) {
    throw new Error('Unable to determine target triple');
  }
  const target = targetInfoFromTriple(TARGET_TRIPLE);
  if (!target) {
    console.warn(
      `[fetch-whisper] No prebuilt whisper-cli package for ${TARGET_TRIPLE}. ` +
        `Place a binary at src-tauri/binaries/whisper-cli-${TARGET_TRIPLE}${process.platform === 'win32' ? '.exe' : ''} ` +
        `or set LOOM_WHISPER_PATH.`,
    );
    return null;
  }

  mkdirSync(BIN_DIR, { recursive: true });
  const outPath = path.join(BIN_DIR, target.sidecarName);
  const runtimeCli = path.join(RUNTIME_DIR, 'whisper-cli.exe');
  if (existsSync(outPath) && (!target.copyRuntime || existsSync(runtimeCli)) && !FORCE) {
    const size = statSync(outPath).size;
    if (size > 100_000) {
      console.log(`[fetch-whisper] Sidecar already exists: ${outPath}`);
      return outPath;
    }
  }

  const baseUrl = `https://github.com/ggml-org/whisper.cpp/releases/download/v${WHISPER_VERSION}`;
  const archiveUrl = `${baseUrl}/${target.archive}`;
  const archivePath = path.join(BIN_DIR, target.archive);
  const tmpDir = path.join(BIN_DIR, '.whisper-extract-tmp');

  console.log(`[fetch-whisper] Downloading ${archiveUrl}`);
  await download(archiveUrl, archivePath);

  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  mkdirSync(tmpDir, { recursive: true });
  extractZip(archivePath, tmpDir);

  const extracted = findBestBinary(tmpDir, target.binaryNames);
  if (!extracted) {
    throw new Error(
      `Could not find a real ${target.binaryNames.join(' / ')} inside ${target.archive} ` +
        `(stubs under 100KB are ignored).`,
    );
  }

  copyFileSync(extracted, outPath);
  if (process.platform !== 'win32') {
    chmodSync(outPath, 0o755);
  }

  if (target.copyRuntime) {
    const releaseDir = path.dirname(extracted);
    try {
      rmSync(RUNTIME_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
    copyWindowsRuntime(releaseDir);
    // Prefer launching the runtime copy so LoadLibrary finds sibling DLLs.
    copyFileSync(extracted, path.join(RUNTIME_DIR, 'whisper-cli.exe'));
  }

  try {
    unlinkSync(archivePath);
  } catch {
    // ignore
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }

  console.log(
    `[fetch-whisper] Installed ${outPath} (sha256: ${sha256File(outPath).slice(0, 16)}…)`,
  );
  return outPath;
}

async function main() {
  console.log(`[fetch-whisper] whisper.cpp v${WHISPER_VERSION}`);
  if (!BINARY_ONLY) {
    await ensureModel();
  }
  if (!MODEL_ONLY) {
    await ensureBinary();
  }
}

main().catch((err) => {
  console.error('[fetch-whisper]', err);
  process.exitCode = 1;
});
