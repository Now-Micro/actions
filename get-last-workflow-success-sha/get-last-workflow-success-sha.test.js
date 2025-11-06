const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { run, parseBool } = require('./get-last-workflow-success-sha');

// Test harness - async version
async function withEnvAsync(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
  let out = '', err = '';
  const so = process.stdout.write, se = process.stderr.write;
  process.stdout.write = (c, e, cb) => { out += c; return true; };
  process.stderr.write = (c, e, cb) => { err += c; return true; };
  try {
    try { await fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
  } finally {
    process.env = prev;
    process.exit = origExit;
    process.stdout.write = so;
    process.stderr.write = se;
  }
  return { exitCode, out, err };
}

async function runWith(env) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glwss-'));
  const tmpOut = path.join(tmpDir, 'output.txt');
  fs.writeFileSync(tmpOut, '');
  const r = await withEnvAsync({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
  r.outputFile = tmpOut;
  r.outputContent = fs.readFileSync(tmpOut, 'utf8');
  fs.rmSync(tmpDir, { recursive: true, force: true });
  return r;
}

// Mock https module
let mockHttpsResponses = [];
let mockHttpsCallCount = 0;
const originalHttpsGet = https.get;

function setMockHttpsResponses(responses) {
  mockHttpsResponses = responses;
  mockHttpsCallCount = 0;
}

function mockHttpsGet(url, options, callback) {
  const response = mockHttpsResponses[mockHttpsCallCount++] || { statusCode: 404, data: '{}' };
  const res = {
    statusCode: response.statusCode,
    on: (event, handler) => {
      if (event === 'data') {
        setImmediate(() => handler(response.data || '{}'));
      } else if (event === 'end') {
        setImmediate(() => handler());
      }
      return res;
    }
  };
  setImmediate(() => callback(res));
  return {
    on: (event, handler) => {
      if (event === 'error' && response.error) {
        setImmediate(() => handler(response.error));
      }
      return this;
    }
  };
}

function enableMockHttps() {
  https.get = mockHttpsGet;
}

function disableMockHttps() {
  https.get = originalHttpsGet;
  mockHttpsResponses = [];
  mockHttpsCallCount = 0;
}

function createRunsResponse(runs) {
  return JSON.stringify({ workflow_runs: runs });
}

function createJobsResponse(jobs) {
  return JSON.stringify({ jobs });
}

// ===== parseBool TESTS =====

test('parseBool handles boolean inputs', () => {
  assert.strictEqual(parseBool(true), true);
  assert.strictEqual(parseBool(false), false);
});

test('parseBool handles string true variants', () => {
  assert.strictEqual(parseBool('true'), true);
  assert.strictEqual(parseBool('True'), true);
  assert.strictEqual(parseBool('TRUE'), true);
  assert.strictEqual(parseBool('1'), true);
  assert.strictEqual(parseBool('yes'), true);
});

test('parseBool handles string false variants', () => {
  assert.strictEqual(parseBool('false'), false);
  assert.strictEqual(parseBool('0'), false);
  assert.strictEqual(parseBool('no'), false);
});

test('parseBool handles empty and undefined', () => {
  assert.strictEqual(parseBool(''), false);
  assert.strictEqual(parseBool(undefined), false);
});

test('parseBool handles whitespace', () => {
  assert.strictEqual(parseBool('  true  '), true);
  assert.strictEqual(parseBool('  false  '), false);
});

// ===== run() TESTS =====

test('httpsGet parses JSON and returns object', async () => {
  // Use the module's httpsGet via require to test parsing path
  const { httpsGet } = require('./get-last-workflow-success-sha');
  // Mock real https.get to return a controlled response
  const orig = require('https').get;
  try {
    require('https').get = (url, options, cb) => {
      const res = { statusCode: 200, on: (ev, h) => { if (ev === 'data') setImmediate(() => h('{"ok":true}')); if (ev === 'end') setImmediate(() => h()); } };
      setImmediate(() => cb(res));
      return { on: () => { } };
    };
    const data = await httpsGet('https://example.com', 'token');
    assert.deepStrictEqual(data, { ok: true });
  } finally {
    require('https').get = orig;
  }
});

test('httpsGet rejects non-2xx with body', async () => {
  const { httpsGet } = require('./get-last-workflow-success-sha');
  const orig = require('https').get;
  try {
    require('https').get = (url, options, cb) => {
      const res = { statusCode: 500, on: (ev, h) => { if (ev === 'data') setImmediate(() => h('error')); if (ev === 'end') setImmediate(() => h()); } };
      setImmediate(() => cb(res));
      return { on: () => { } };
    };
    await assert.rejects(() => httpsGet('https://example.com', 'token'));
  } finally {
    require('https').get = orig;
  }
});

test('fetchWithRetry retries then succeeds', async () => {
  const { fetchWithRetry } = require('./get-last-workflow-success-sha');
  // First call will error, second will return a valid runs object
  setMockHttpsResponses([
    { error: new Error('net') },
    { statusCode: 200, data: createRunsResponse([]) }
  ]);
  enableMockHttps();
  try {
    const res = await fetchWithRetry('https://api.github.com/', 'token', 3, true);
    assert.deepStrictEqual(res, { workflow_runs: [] });
    assert.ok(mockHttpsCallCount >= 2);
  } finally {
    disableMockHttps();
  }
});

test('run() validation fails without required inputs', async () => {
  const r = await runWith({ GITHUB_REPOSITORY: 'x/y' });
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.err + r.out, /INPUT_JOB_NAME is required/);
});

test('run() falls back to default branch when API fails', async () => {
  setMockHttpsResponses([{ error: new Error('x') }]);
  enableMockHttps();
  try {
    const r = await runWith({
      INPUT_JOB_NAME: 'test-setup',
      INPUT_TEST_JOB_NAMES: 'node-tests',
      INPUT_WORKFLOW_NAME: 'checks.yml',
      INPUT_GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_BRANCH: 'br',
      INPUT_DEFAULT_BRANCH: 'main'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /last_success_sha=main/);
  } finally {
    disableMockHttps();
  }
});

test('run() selects qualifying run with jobs', async () => {
  const runObj = { id: 1, head_sha: 'aa', status: 'completed', conclusion: 'success' };
  setMockHttpsResponses([
    { statusCode: 200, data: createRunsResponse([runObj]) },
    { statusCode: 200, data: createJobsResponse([{ name: 'test-setup', conclusion: 'success' }, { name: 'node-tests', conclusion: 'success' }]) }
  ]);
  enableMockHttps();
  try {
    const r = await runWith({
      INPUT_JOB_NAME: 'test-setup',
      INPUT_TEST_JOB_NAMES: 'node-tests',
      INPUT_WORKFLOW_NAME: 'checks.yml',
      INPUT_GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_BRANCH: 'br',
      INPUT_DEFAULT_BRANCH: 'main'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /last_success_sha=aa/);
  } finally {
    disableMockHttps();
  }
});

test('run() ignores cancelled runs', async () => {
  const runObj = { id: 2, head_sha: 'bb', status: 'completed', conclusion: 'cancelled' };
  setMockHttpsResponses([{ statusCode: 200, data: createRunsResponse([runObj]) }]);
  enableMockHttps();
  try {
    const r = await runWith({
      INPUT_JOB_NAME: 'test-setup',
      INPUT_TEST_JOB_NAMES: 'node-tests',
      INPUT_WORKFLOW_NAME: 'checks.yml',
      INPUT_GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_BRANCH: 'br',
      INPUT_DEFAULT_BRANCH: 'main'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /last_success_sha=main/);
  } finally {
    disableMockHttps();
  }
});

test('run() treats missing test jobs as missing and falls back', async () => {
  const runObj = { id: 3, head_sha: 'cc', status: 'completed', conclusion: 'success' };
  setMockHttpsResponses([
    { statusCode: 200, data: createRunsResponse([runObj]) },
    { statusCode: 200, data: createJobsResponse([{ name: 'other', conclusion: 'success' }]) }
  ]);
  enableMockHttps();
  try {
    const r = await runWith({
      INPUT_JOB_NAME: 'test-setup',
      INPUT_TEST_JOB_NAMES: 'node-tests',
      INPUT_WORKFLOW_NAME: 'checks.yml',
      INPUT_GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_BRANCH: 'br',
      INPUT_DEFAULT_BRANCH: 'main'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /last_success_sha=main/);
  } finally {
    disableMockHttps();
  }
});

test('run() when test jobs present but failing - fallback', async () => {
  const runObj = { id: 4, head_sha: 'dd', status: 'completed', conclusion: 'success' };
  setMockHttpsResponses([
    { statusCode: 200, data: createRunsResponse([runObj]) },
    { statusCode: 200, data: createJobsResponse([{ name: 'test-setup', conclusion: 'success' }, { name: 'node-tests', conclusion: 'failure' }]) }
  ]);
  enableMockHttps();
  try {
    const r = await runWith({
      INPUT_JOB_NAME: 'test-setup',
      INPUT_TEST_JOB_NAMES: 'node-tests',
      INPUT_WORKFLOW_NAME: 'checks.yml',
      INPUT_GITHUB_TOKEN: 't',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_BRANCH: 'br',
      INPUT_DEFAULT_BRANCH: 'main'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /last_success_sha=main/);
  } finally {
    disableMockHttps();
  }
});

