/**
 * Contract Schema & Fixture Validator (P4-T1 / Part I2 V10)
 * Validates all available @chronyx/contracts fixtures and constants against
 * their exact frozen zod schemas, and exports validateContractPayload() for
 * validating live REST and Socket.IO payloads in V2-V9.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const contractsDistPath = path.join(rootDir, 'packages', 'contracts', 'dist', 'index.js');

async function loadContracts() {
  if (!fs.existsSync(contractsDistPath)) {
    execSync('npm run build -w @chronyx/contracts', { cwd: rootDir, stdio: 'inherit' });
  }
  return import(pathToFileURL(contractsDistPath).href);
}

/**
 * Validate an arbitrary payload against a named zod schema from @chronyx/contracts.
 * Throws a descriptive Error if the schema name is unknown or validation fails.
 */
export async function validateContractPayload(schemaName, payload) {
  const contracts = await loadContracts();
  const schema = contracts[schemaName];
  if (!schema || typeof schema.safeParse !== 'function') {
    throw new Error(`Unknown or invalid contract schema: ${schemaName}`);
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new Error(`Contract validation failed for ${schemaName}: ${issues}`);
  }
  return result.data;
}

/**
 * Run fixture validation for every fixture exported by @chronyx/contracts.
 * Returns { passed, failed, skipped, results }.
 */
export async function validateAllFixtures() {
  const contracts = await loadContracts();

  const checks = [
    ['NodeInfoSchema', 'mockNodeInfo'],
    ['HeartbeatSchema', 'mockHeartbeat'],
    ['HeartbeatAckSchema', 'mockHeartbeatAck'],
    ['AssessmentSchema', 'mockAssessment'],
    ['TransitionSchema', 'mockTransition'],
    ['NetworkHealthSchema', 'mockNetworkHealth'],
    ['AnchorInfoSchema', 'mockAnchorInfo'],
    ['FaultSchema', 'mockFault'],
    ['IncidentSummarySchema', 'mockIncidentSummary'],
    ['IncidentSchema', 'mockIncident'],
    ['ObservationSchema', 'mockObservation'],
    ['PassportSchema', 'mockPassport'],
    ['BaselineStateSchema', 'mockBaselineState'],
    ['SnapshotSchema', 'mockSnapshot'],
    ['HistoryPointSchema', 'mockHistoryPoint'],
    ['LiveMetricsSchema', 'mockLiveMetrics'],
    ['BenchmarkRunSchema', 'mockBenchmarkRun'],
    ['ScienceReplayResSchema', 'mockScienceReplayRes'],
    ['JoinInfoSchema', 'mockJoinInfo'],
    ['EngineConfigSchema', 'DEFAULT_ENGINE_CONFIG'],
  ];

  const results = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const [schemaName, fixtureName] of checks) {
    const schema = contracts[schemaName];
    const fixture = contracts[fixtureName];

    if (!schema) {
      failed += 1;
      results.push({ schemaName, fixtureName, ok: false, error: 'Missing schema export' });
      continue;
    }

    if (fixture === undefined) {
      // Expected after H+14:00 mock purge if fixtures.ts is removed
      skipped += 1;
      results.push({ schemaName, fixtureName, ok: true, skipped: true });
      continue;
    }

    const parsed = schema.safeParse(fixture);
    if (parsed.success) {
      passed += 1;
      results.push({ schemaName, fixtureName, ok: true });
    } else {
      failed += 1;
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      results.push({ schemaName, fixtureName, ok: false, error: issues });
    }
  }

  return { passed, failed, skipped, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateAllFixtures()
    .then(({ passed, failed, skipped, results }) => {
      console.info(
        `Contract fixture validation: ${passed} passed, ${failed} failed, ${skipped} skipped.`,
      );
      if (failed > 0) {
        for (const r of results.filter((item) => !item.ok)) {
          console.error(` - FAIL ${r.fixtureName} -> ${r.schemaName}: ${r.error}`);
        }
        process.exit(1);
      }
      if (passed === 0) {
        console.error('No contract fixtures or config schemas were validated.');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Contract validation error:', err);
      process.exit(1);
    });
}
