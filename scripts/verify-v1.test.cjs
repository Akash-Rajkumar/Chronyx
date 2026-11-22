const assert = require('node:assert/strict');
const test = require('node:test');

const {
  evaluateV1HealthPayload,
  healthUrlFromBaseUrl,
  isV1CompatibleContractVersion,
  stepV1Boot,
} = require('./verify.cjs');

test('V1 accepts the approved 1.0.x contract-version family', () => {
  assert.equal(isV1CompatibleContractVersion('1.0.0'), true);
  assert.equal(isV1CompatibleContractVersion('1.0.1'), true);
  assert.equal(isV1CompatibleContractVersion('1.0.42'), true);
});

test('V1 rejects versions outside the approved 1.0.x family', () => {
  assert.equal(isV1CompatibleContractVersion('1.1.0'), false);
  assert.equal(isV1CompatibleContractVersion('2.0.0'), false);
  assert.equal(isV1CompatibleContractVersion('1.0.01'), false);
  assert.equal(isV1CompatibleContractVersion('1.0.1-beta.1'), false);
  assert.equal(isV1CompatibleContractVersion('1.0.1-rc.1'), false);
  assert.equal(isV1CompatibleContractVersion('1.0.1+build.1'), false);
  assert.equal(isV1CompatibleContractVersion('1.0'), false);
  assert.equal(isV1CompatibleContractVersion('v1.0.1'), false);
  assert.equal(isV1CompatibleContractVersion(' 1.0.1 '), false);
  assert.equal(isV1CompatibleContractVersion('1.0.1\n'), false);
  assert.equal(isV1CompatibleContractVersion('not-a-version'), false);
  assert.equal(isV1CompatibleContractVersion(null), false);
  assert.equal(isV1CompatibleContractVersion(undefined), false);
  assert.equal(isV1CompatibleContractVersion(101), false);
});

test('V1 passes a healthy 1.0.1 response', () => {
  const result = evaluateV1HealthPayload({ ok: true, db: 'up', contract_version: '1.0.1' });
  assert.equal(result.ok, true);
  assert.match(result.detail, /accepted 1\.0\.x/);
});

test('V1 rejects unhealthy or incompatible health responses', () => {
  assert.equal(evaluateV1HealthPayload({ ok: true, db: 'down', contract_version: '1.0.1' }).ok, false);
  assert.equal(evaluateV1HealthPayload({ ok: true, db: 'up', contract_version: '1.1.0' }).ok, false);
  assert.equal(evaluateV1HealthPayload({ ok: false, db: 'up', contract_version: '1.0.1' }).ok, false);
  assert.equal(evaluateV1HealthPayload({ ok: 'true', db: 'up', contract_version: '1.0.1' }).ok, false);
  assert.equal(evaluateV1HealthPayload(null).ok, false);
  assert.equal(evaluateV1HealthPayload(undefined).ok, false);
  assert.equal(evaluateV1HealthPayload('healthy').ok, false);
  assert.equal(evaluateV1HealthPayload([]).ok, false);
  assert.equal(evaluateV1HealthPayload({}).ok, false);
});

test('V1 health URL preserves a configured base origin', () => {
  assert.equal(healthUrlFromBaseUrl('http://10.0.0.8:3001'), 'http://10.0.0.8:3001/api/v1/health');
  assert.equal(healthUrlFromBaseUrl('http://10.0.0.8:3001/'), 'http://10.0.0.8:3001/api/v1/health');
});

test('the actual V1 fetch gate accepts a 1.0.1 health response', async () => {
  const priorFetch = global.fetch;
  const priorBaseUrl = process.env.CHRONYX_VERIFY_BASE_URL;
  process.env.CHRONYX_VERIFY_BASE_URL = 'http://verify.example:3001';
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ ok: true, db: 'up', contract_version: '1.0.1' }),
    };
  };

  try {
    const result = await stepV1Boot();
    assert.equal(result.status, 'PASS');
    assert.match(result.detail, /1\.0\.1/);
    assert.equal(requestedUrl, 'http://verify.example:3001/api/v1/health');
  } finally {
    global.fetch = priorFetch;
    if (priorBaseUrl === undefined) {
      delete process.env.CHRONYX_VERIFY_BASE_URL;
    } else {
      process.env.CHRONYX_VERIFY_BASE_URL = priorBaseUrl;
    }
  }
});

test('the actual V1 fetch gate defaults to http://localhost:3001 when CHRONYX_VERIFY_BASE_URL is unset', async () => {
  const priorFetch = global.fetch;
  const priorBaseUrl = process.env.CHRONYX_VERIFY_BASE_URL;
  delete process.env.CHRONYX_VERIFY_BASE_URL;
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ ok: true, db: 'up', contract_version: '1.0.1' }),
    };
  };

  try {
    const result = await stepV1Boot();
    assert.equal(result.status, 'PASS');
    assert.match(result.detail, /1\.0\.1/);
    assert.equal(requestedUrl, 'http://localhost:3001/api/v1/health');
  } finally {
    global.fetch = priorFetch;
    if (priorBaseUrl === undefined) {
      delete process.env.CHRONYX_VERIFY_BASE_URL;
    } else {
      process.env.CHRONYX_VERIFY_BASE_URL = priorBaseUrl;
    }
  }
});

test('the actual V1 fetch gate rejects HTTP error, malformed JSON, db down, and incompatible contract_version', async () => {
  const priorFetch = global.fetch;
  const priorBaseUrl = process.env.CHRONYX_VERIFY_BASE_URL;
  process.env.CHRONYX_VERIFY_BASE_URL = 'http://verify.example:3001';

  try {
    global.fetch = async () => ({ ok: false, status: 503 });
    assert.equal((await stepV1Boot()).status, 'FAIL');

    global.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    assert.equal((await stepV1Boot()).status, 'FAIL');

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, db: 'down', contract_version: '1.0.1' }),
    });
    assert.equal((await stepV1Boot()).status, 'FAIL');

    global.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, db: 'up', contract_version: '1.1.0' }),
    });
    assert.equal((await stepV1Boot()).status, 'FAIL');
  } finally {
    global.fetch = priorFetch;
    if (priorBaseUrl === undefined) {
      delete process.env.CHRONYX_VERIFY_BASE_URL;
    } else {
      process.env.CHRONYX_VERIFY_BASE_URL = priorBaseUrl;
    }
  }
});
