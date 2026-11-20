/**
 * Check No Mocks Script
 * Master Prompt Part D4 & Part I1:
 * Validates mock policy.
 * Flag --strict: Asserts zero MOCK-DATA tags exist in the entire repo (for H+14:00+ gate).
 * Without --strict: Asserts MOCK-DATA only exists in explicitly allowed paths:
 *   - packages/contracts/src/fixtures.ts
 *   - apps/web/src/mocks/**
 *   - apps/server/src/mocks/**
 *   - packages/engine/src/index.ts (S0 stub only)
 */
const fs = require('fs');
const path = require('path');

const isStrict = process.argv.includes('--strict');
const rootDir = path.resolve(__dirname, '..');

const allowedPrefixes = [
  path.join('packages', 'contracts', 'src', 'fixtures.ts'),
  path.join('apps', 'web', 'src', 'mocks'),
  path.join('apps', 'server', 'src', 'mocks'),
  path.join('packages', 'engine', 'src'), // S0 engine stub
];

let violations = [];
let mockFilesFound = [];

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(rootDir, fullPath);

    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'dist' ||
      entry.name === 'scripts' ||
      entry.name === 'docs' ||
      entry.name.endsWith('.pdf') ||
      entry.name.endsWith('.md')
    ) {
      continue;
    }

    if (entry.isDirectory()) {
      scanDir(fullPath);
    } else if (entry.isFile() && /\.(ts|tsx|js|cjs|mjs|json)$/.test(entry.name)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('MOCK-DATA')) {
        mockFilesFound.push(relPath);
        if (isStrict) {
          violations.push(`[STRICT VIOLATION] Mock marker found in ${relPath}`);
        } else {
          const isAllowed = allowedPrefixes.some((allowed) => relPath.startsWith(allowed));
          if (!isAllowed) {
            violations.push(`[ILLEGAL MOCK LOCATION] Mock marker in unauthorized file: ${relPath}`);
          }
        }
      }
    }
  }
}

scanDir(rootDir);

console.info(`Scan complete. Found ${mockFilesFound.length} files with MOCK-DATA markers.`);
if (mockFilesFound.length > 0) {
  console.info('Mock files:');
  mockFilesFound.forEach((f) => console.info(` - ${f}`));
}

if (violations.length > 0) {
  console.error('\nMock hygiene check FAILED with violations:');
  violations.forEach((v) => console.error(v));
  process.exit(1);
} else {
  console.info('\nMock hygiene check PASSED.');
}

