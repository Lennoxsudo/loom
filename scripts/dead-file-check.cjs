const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const srcDir = path.join(ROOT, 'src');

// Recursively collect all .ts/.tsx files under src, excluding __tests__ dirs and .test.* files
function collectFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__snapshots__' || entry.name === 'node_modules') continue;
      collectFiles(fullPath, results);
    } else if (entry.isFile()) {
      const isTs = entry.name.endsWith('.ts') || entry.name.endsWith('.tsx');
      if (!isTs) continue;
      if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
      results.push(fullPath);
    }
  }
  return results;
}

const allFiles = collectFiles(srcDir);

// Read ALL ts/tsx/css files (including tests) for import scanning
function collectAllFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectAllFiles(fullPath, results);
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') || entry.name.endsWith('.css')) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const allScanFiles = collectAllFiles(srcDir);
const fileContents = {};
for (const f of allScanFiles) {
  try {
    const rel = path.relative(srcDir, f).replace(/\\/g, '/');
    fileContents[rel] = fs.readFileSync(f, 'utf8');
  } catch {
    // ignore unreadable files
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const deadFiles = [];

for (const f of allFiles) {
  const rel = path.relative(srcDir, f).replace(/\\/g, '/');
  const basename = path.basename(f).replace(/\.(ts|tsx)$/, '');

  // Skip entry files and barrel files
  if (rel === 'main.tsx' || rel === 'App.tsx') continue;
  if (path.basename(f) === 'index.ts' || path.basename(f) === 'index.tsx') continue;
  if (rel === 'vite-env.d.ts') continue;

  let isImported = false;
  const escBase = escapeRegex(basename);

  for (const [otherRel, content] of Object.entries(fileContents)) {
    if (otherRel === rel) continue;

    const patterns = [
      new RegExp("from\\s+['\"][^'\"]*" + escBase + "['\"]", 'i'),
      new RegExp("import\\s*\\([^)]*" + escBase, 'i'),
      new RegExp("require\\s*\\([^)]*" + escBase, 'i'),
    ];

    for (const p of patterns) {
      if (p.test(content)) {
        isImported = true;
        break;
      }
    }
    if (isImported) break;
  }

  if (!isImported) {
    deadFiles.push(rel);
  }
}

console.log('=== POTENTIAL DEAD FILES (never imported by any other file) ===');
console.log('Total non-test .ts/.tsx files checked:', allFiles.length);
console.log('Dead file count:', deadFiles.length);
console.log('');
deadFiles.sort().forEach((f) => console.log(f));
