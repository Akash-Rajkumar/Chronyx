/**
 * Chronyx End-to-End Verification Runner (P4-T1 / Part I2)
 * Executes verification steps V0 to V15 as separate functions and writes
 * docs/VERIFY_REPORT.md with commit hash, timestamp, and pass/fail per step.
 *
 * Unimplemented steps fail explicitly as STUB_FAIL (never a false pass).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const reportPath = path.join(rootDir, 'docs', 'VERIFY_REPORT.md');

function runCommand(cmd) {
  try {
    const output = execSync(cmd, { cwd: rootDir, encoding: 'utf8', stdio: 'pipe' });
    return { ok: true, output: output.trim() };
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    const stdout = err.stdout ? String(err.stdout).trim() : '';
    return { ok: false, output: stderr || stdout || err.message };
  }
}

function makeStubFailure(id, name, reason) {
  return {
    id,
    name,
    status: 'STUB_FAIL',
    detail: `NOT IMPLEMENTED: ${reason}`,
    durationMs: 0,
  };
}

async function timedStep(id, name, fn) {
  const start = Date.now();
  try {
    const res = await fn();
    return {
      id,
      name,
      status: res.ok ? 'PASS' : 'FAIL',
      detail: res.detail,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      id,
      name,
      status: 'FAIL',
      detail: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// V0: npm run check (typecheck, lint, unit tests)
function stepV0Check() {
  return timedStep('V0', 'check (typecheck, lint, unit tests)', () => {
    const res = runCommand('npm run check');
    return {
      ok: res.ok,
      detail: res.ok ? 'tsc --build, eslint, and vitest passed' : res.output.split('\n').slice(-5).join(' | '),
    };
  });
}

// V1: Boot (migrations applied, /health reports db: 'up', contract_version 1.0.x)
function isV1CompatibleContractVersion(contractVersion) {
  return typeof contractVersion === 'string' && /^1\.0\.(?:0|[1-9]\d*)$/.test(contractVersion);
}

function healthUrlFromBaseUrl(baseUrl) {
  return new URL('/api/v1/health', baseUrl).toString();
}

function evaluateV1HealthPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, detail: 'Health response was not a JSON object' };
  }
  if (payload.ok !== true) {
    return { ok: false, detail: 'Health response did not report ok: true' };
  }
  if (payload.db !== 'up') {
    return { ok: false, detail: `Health response reported db: ${String(payload.db)} (expected up)` };
  }
  if (!isV1CompatibleContractVersion(payload.contract_version)) {
    return {
      ok: false,
      detail: `Unsupported contract_version ${JSON.stringify(payload.contract_version)} (expected 1.0.x)`,
    };
  }
  return {
    ok: true,
    detail: `Health reports db: up and contract_version ${payload.contract_version} (accepted 1.0.x)`,
  };
}

async function stepV1Boot() {
  return timedStep('V1', 'Boot (/health, migrations, contract_version)', async () => {
    const configuredBaseUrl =
      typeof process.env.CHRONYX_VERIFY_BASE_URL === 'string'
        ? process.env.CHRONYX_VERIFY_BASE_URL.trim()
        : '';
    const baseUrl = configuredBaseUrl || 'http://localhost:3001';
    const healthUrl = healthUrlFromBaseUrl(baseUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const response = await fetch(healthUrl, { signal: controller.signal });
      if (!response.ok) {
        return { ok: false, detail: `GET ${healthUrl} returned HTTP ${response.status}` };
      }
      const payload = await response.json();
      return evaluateV1HealthPayload(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: `GET ${healthUrl} failed: ${message}` };
    } finally {
      clearTimeout(timeout);
    }
  });
}

// V2: Clean run (3 virtual + 2 headless agents for 5 min, 0 transitions/incidents)
function stepV2CleanRun() {
  return makeStubFailure(
    'V2',
    'Clean run (5 min, 3 virtual + 2 headless)',
    'Requires P1-T3/P1-T4 gateway+orchestrator, P2-T1/P2-T2 sim+engine, P3-T2 agent',
  );
}

// V3: Integrity (BAD_SIGNATURE and CHAIN_BREAK rejections)
function stepV3Integrity() {
  return makeStubFailure(
    'V3',
    'Integrity (BAD_SIGNATURE, CHAIN_BREAK)',
    'Requires P1-T3 gateway heartbeat verification against live server',
  );
}

// V4: Jump (POST /demo/scenario jump quarantined <=10s, incident opened, obs held)
function stepV4Jump() {
  return makeStubFailure(
    'V4',
    'Jump (quarantine <=10s, incident, held obs)',
    'Requires P1-T4/P1-T5 orchestrator+observations and P2-T2/P2-T3 engine+lab',
  );
}

// V5: Recovery (calm -> recovering -> trusted <=150s, held obs released/rejected)
function stepV5Recovery() {
  return makeStubFailure(
    'V5',
    'Recovery (<=150s, obs released/rejected)',
    'Requires P1-T5 observations re-scoring and P2-T2 engine recovery path',
  );
}

// V6: Slow drag (slow_drag flagged <=180s)
function stepV6SlowDrag() {
  return makeStubFailure(
    'V6',
    'Slow drag (CUSUM flagged <=180s)',
    'Requires P2-T2 CUSUM engine and P2-T3 lab scenarios',
  );
}

// V7: Baseline (alarm=false every tick, followed_error_ms within 1 ms of truth)
function stepV7Baseline() {
  return makeStubFailure(
    'V7',
    'Baseline (alarm=false, error within 1 ms)',
    'Requires P2-T3 /baseline and live V4/V6 runs',
  );
}

// V8: Science (/science/replay fault_ms=10, 200 trials: >10% vs <3%)
function stepV8Science() {
  return makeStubFailure(
    'V8',
    'Science (/science/replay >10% vs <3%)',
    'Requires P2-T4 science replay route on live server',
  );
}

// V9: Benchmarks (50-repeat ramp <=60s, detect_rate >=0.9, clean false alarms)
function stepV9Benchmarks() {
  return makeStubFailure(
    'V9',
    'Benchmarks (50 repeats <=60s)',
    'Requires P2-T5 benchmark runner on live server',
  );
}

// V10: Contracts (fixture zod validation + live REST/socket payload validation)
function stepV10Contracts() {
  const start = Date.now();
  const res = runCommand('node scripts/verify-contracts.mjs');
  if (!res.ok) {
    return {
      id: 'V10',
      name: 'Contracts (zod fixture & live payload validation)',
      status: 'FAIL',
      detail: res.output,
      durationMs: Date.now() - start,
    };
  }
  return {
    id: 'V10',
    name: 'Contracts (zod fixture & live payload validation)',
    status: 'STUB_FAIL',
    detail: `NOT YET VERIFIED: ${res.output}; live REST/socket payloads from V2-V9 not yet captured`,
    durationMs: Date.now() - start,
  };
}

// V11: Pages (Playwright 1366x768, zero console errors, frozen test ids)
function stepV11Pages() {
  return makeStubFailure(
    'V11',
    'Pages (Playwright 1366x768)',
    'Requires @playwright/test (coordinate with P1) and Part G pages (P3/P4)',
  );
}

// V12: Mobile join (Playwright 360x740, /join + judge_attack quarantine)
function stepV12MobileJoin() {
  return makeStubFailure(
    'V12',
    'Mobile join (Playwright 360x740)',
    'Requires @playwright/test (coordinate with P1) and P3-T2 /join + P2-T3',
  );
}

// V13: No mocks and no secrets (post-purge strict gate: zero MOCK-DATA matches)
function stepV13NoMocksAndSecrets() {
  return timedStep('V13', 'No mocks and no secrets', () => {
    const mockRes = runCommand('node scripts/check-no-mocks.cjs --strict');
    if (!mockRes.ok) {
      return {
        ok: false,
        detail: `Post-purge strict mock gate failed (zero matches required): ${mockRes.output.split('\n')[0]}`,
      };
    }

    const trackedRes = runCommand('git ls-files');
    if (!trackedRes.ok) {
      return { ok: false, detail: `Failed to list tracked files: ${trackedRes.output}` };
    }

    const trackedFiles = trackedRes.output.split(/\r?\n/).filter(Boolean);
    const forbiddenEnvFiles = trackedFiles.filter((filePath) => {
      const base = path.basename(filePath);
      return base === '.env' || (base.startsWith('.env.') && base !== '.env.example');
    });

    if (forbiddenEnvFiles.length > 0) {
      return {
        ok: false,
        detail: `Committed .env file(s) found: ${forbiddenEnvFiles.join(', ')}`,
      };
    }

    const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
    const secretHits = [];
    for (const relPath of trackedFiles) {
      if (relPath.startsWith('scripts/') || relPath.endsWith('.pdf')) {
        continue;
      }
      const absPath = path.join(rootDir, relPath);
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) {
        continue;
      }
      const content = fs.readFileSync(absPath, 'utf8');
      if (jwtPattern.test(content)) {
        secretHits.push(relPath);
      }
    }

    if (secretHits.length > 0) {
      return {
        ok: false,
        detail: `Potential JWT/service-role secret found in: ${secretHits.join(', ')}`,
      };
    }

    return {
      ok: true,
      detail: `check-no-mocks --strict passed (0 MOCK-DATA matches); 0 .env files or JWT secrets in ${trackedFiles.length} tracked files`,
    };
  });
}

// V14: Docs (docs/README.md run instructions, architecture, honest limits)
function stepV14Docs() {
  return timedStep('V14', 'Docs (docs/README.md)', () => {
    const readmePath = path.join(rootDir, 'docs', 'README.md');
    if (!fs.existsSync(readmePath)) {
      return {
        ok: false,
        detail: 'Missing docs/README.md (scheduled for P4-T6/P4-T7)',
      };
    }
    const content = fs.readFileSync(readmePath, 'utf8').toLowerCase();
    const hasRun = content.includes('npm run') || content.includes('install');
    const hasArch = content.includes('architecture');
    const hasLimits = content.includes('limit');
    if (!hasRun || !hasArch || !hasLimits) {
      return {
        ok: false,
        detail: 'docs/README.md missing required sections (run instructions, architecture, limits)',
      };
    }
    return { ok: true, detail: 'docs/README.md present with required sections' };
  });
}

// V15: Deployed smoke (post-deploy health, scenario, page, WebSocket)
function stepV15DeployedSmoke() {
  return makeStubFailure(
    'V15',
    'Deployed smoke',
    'Requires deployed server/web URLs (P1-T6) and deployed E2E runner',
  );
}

function getCommitHash() {
  const res = runCommand('git rev-parse HEAD');
  return res.ok ? res.output : 'unknown';
}

function formatReport(commitHash, timestamp, results) {
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const stubCount = results.filter((r) => r.status === 'STUB_FAIL').length;
  const overall = failCount === 0 && stubCount === 0 ? 'PASS' : 'FAIL (incomplete/failing steps)';

  const rows = results
    .map(
      (r) =>
        `| ${r.id} | ${r.name} | **${r.status}** | ${r.durationMs} ms | ${r.detail.replace(/\|/g, '\\|')} |`,
    )
    .join('\n');

  return `# Chronyx Verification Report

> Auto-generated by \`npm run verify\` (\`scripts/verify.cjs\`). Do not edit manually.

- **Commit:** \`${commitHash}\`
- **Timestamp:** \`${timestamp}\`
- **Overall:** **${overall}** (${passCount} PASS, ${failCount} FAIL, ${stubCount} STUB_FAIL)

| Step | Check | Status | Duration | Details |
| :--- | :--- | :--- | :--- | :--- |
${rows}
`;
}

async function main() {
  console.info('=== Chronyx Verification Runner (Part I2) ===');

  const steps = [
    stepV0Check,
    stepV1Boot,
    stepV2CleanRun,
    stepV3Integrity,
    stepV4Jump,
    stepV5Recovery,
    stepV6SlowDrag,
    stepV7Baseline,
    stepV8Science,
    stepV9Benchmarks,
    stepV10Contracts,
    stepV11Pages,
    stepV12MobileJoin,
    stepV13NoMocksAndSecrets,
    stepV14Docs,
    stepV15DeployedSmoke,
  ];

  const results = [];
  for (const stepFn of steps) {
    const res = await stepFn();
    results.push(res);
    console.info(`[${res.status}] ${res.id} (${res.name}): ${res.detail}`);
  }

  const commitHash = getCommitHash();
  const timestamp = new Date().toISOString();
  const reportContent = formatReport(commitHash, timestamp, results);
  fs.writeFileSync(reportPath, reportContent, 'utf8');
  console.info(`\nVerification report written to ${reportPath}`);

  const hasFailures = results.some((r) => r.status !== 'PASS');
  if (hasFailures) {
    console.error('\nVerification FAILED: one or more steps failed or are unimplemented stubs.');
    process.exit(1);
  }
}

module.exports = {
  evaluateV1HealthPayload,
  healthUrlFromBaseUrl,
  isV1CompatibleContractVersion,
  stepV1Boot,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
