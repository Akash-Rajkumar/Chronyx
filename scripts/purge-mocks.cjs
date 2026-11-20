/**
 * Purge Mocks Script (Part I1)
 * Scheduled for H+14:00 feature freeze
 * Deletes fixtures and mock directories.
 */
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const pathsToPurge = [
  path.join(rootDir, 'apps', 'web', 'src', 'mocks'),
  path.join(rootDir, 'apps', 'server', 'src', 'mocks'),
];

console.info('Running purge-mocks...');
for (const p of pathsToPurge) {
  if (fs.existsSync(p)) {
    console.info(`Removing mock directory: ${p}`);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

console.info('Purge complete. Run npm run check-no-mocks -- --strict to verify.');

