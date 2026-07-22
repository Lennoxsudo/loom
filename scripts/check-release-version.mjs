#!/usr/bin/env node
/**
 * Ensure package.json, package-lock.json, Cargo.toml, tauri.conf.json,
 * and optional tag all share the same SemVer.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(root, rel), 'utf8'));
}

function readText(rel) {
  return readFileSync(resolve(root, rel), 'utf8');
}

function cargoVersion(toml) {
  const m = toml.match(/^\s*version\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('version not found in Cargo.toml');
  return m[1];
}

function normalize(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const cargo = cargoVersion(readText('src-tauri/Cargo.toml'));
const tauri = readJson('src-tauri/tauri.conf.json');

const versions = {
  'package.json': normalize(pkg.version),
  'package-lock.json': normalize(lock.version || lock.packages?.['']?.version),
  'src-tauri/Cargo.toml': normalize(cargo),
  'src-tauri/tauri.conf.json': normalize(tauri.version),
};

const tag = process.env.GITHUB_REF_NAME || process.env.RELEASE_TAG || '';
if (tag) {
  versions.tag = normalize(tag);
}

const unique = [...new Set(Object.values(versions))];
if (unique.length !== 1 || !unique[0]) {
  console.error('Version mismatch:');
  for (const [k, v] of Object.entries(versions)) {
    console.error(`  ${k}: ${v || '(missing)'}`);
  }
  process.exit(1);
}

console.log(`Release version OK: ${unique[0]}`);
