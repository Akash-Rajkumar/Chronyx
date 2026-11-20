/**
 * S0 Stub / Verification Runner (P4-T1 owns the full harness)
 * Part I2: Runs verification steps V0 to V15 and outputs docs/VERIFY_REPORT.md
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.info('=== Chronyx Verification Runner ===');
console.info('Executing V0 check (typecheck, lint, test)...');

let v0Pass = false;
try {
  execSync('npm run check', { stdio: 'inherit' });
  v0Pass = true;
} catch {
  v0Pass = false;
}

const commitHash = (() => {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
})();

const reportPath = path.join(__dirname, '..', 'docs', 'VERIFY_REPORT.md');
const timestamp = new Date().toISOString();

const content = `# Chronyx Verification Report

- **Commit:** \`${commitHash}\`
- **Timestamp:** \`${timestamp}\`
- **V0 (check):** ${v0Pass ? 'PASS' : 'FAIL'}
- **V1 (Boot):** PENDING (P4-T1)
- **V2 (Clean run):** PENDING (P4-T1)
- **V3 (Integrity):** PENDING (P4-T1)
- **V4 (Jump):** PENDING (P4-T1)
- **V5 (Recovery):** PENDING (P4-T1)
- **V6 (Slow drag):** PENDING (P4-T1)
- **V7 (Baseline):** PENDING (P4-T1)
- **V8 (Science):** PENDING (P4-T1)
- **V9 (Benchmarks):** PENDING (P4-T1)
- **V10 (Contracts):** PENDING (P4-T1)
- **V11 (Pages):** PENDING (P4-T1)
- **V12 (Mobile join):** PENDING (P4-T1)
- **V13 (No mocks/secrets):** PENDING (P4-T1)
- **V14 (Docs):** PENDING (P4-T1)
- **V15 (Deployed smoke):** PENDING (P4-T1)
`;

fs.writeFileSync(reportPath, content, 'utf8');
console.info(`Verification report written to ${reportPath}`);
if (!v0Pass) {
  process.exit(1);
}

