const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { test, beforeEach, afterEach } = require('node:test');
const { run } = require('./assert');

function execAssertion(env) {
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = (code = 0) => { exitCode = code; throw new Error(`__EXIT_${code}__`); };

  const originalEnv = { ...process.env };
  Object.assign(process.env, env);

  try {
    run();
  } catch (e) {
    if (!e.message.startsWith('__EXIT_')) throw e;
  } finally {
    // restore
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
    // reset env
    Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
    Object.entries(originalEnv).forEach(([k, v]) => process.env[k] = v);
  }

  const summaryFile = env.INPUT_SUMMARY_FILE;
  const summary = summaryFile && fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  return { logs, exitCode, summary };
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-action-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { }
});

function baseEnv(overrides) {
  return Object.assign({
    INPUT_EXPECTED: '',
    INPUT_ACTUAL: '',
    INPUT_SUMMARY_FILE: path.join(tmpDir, 'summary.txt'),
    INPUT_TEST_NAME: 'Test Name',
    INPUT_MODE: 'exact'
  }, overrides);
}

// exact success
test('exact mode passes when strings match', () => {
  const { exitCode, summary } = execAssertion(baseEnv({ INPUT_EXPECTED: 'foo', INPUT_ACTUAL: 'foo' }));
  assert.strictEqual(exitCode, 0);
  assert.match(summary, /PASS: Test Name/);
});

// exact fail
test('exact mode fails when strings differ', () => {
  const { exitCode, summary } = execAssertion(baseEnv({ INPUT_EXPECTED: 'foo', INPUT_ACTUAL: 'bar' }));
  assert.strictEqual(exitCode, 1);
  assert.match(summary, /FAIL: Test Name/);
});

// endswith pass
test('endswith mode passes when actual ends with expected', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'endswith', INPUT_EXPECTED: 'end', INPUT_ACTUAL: 'the-end' }));
  assert.strictEqual(exitCode, 0);
});

// endswith fail
test('endswith mode fails when actual does not end with expected', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'endswith', INPUT_EXPECTED: 'fin', INPUT_ACTUAL: 'the-end' }));
  assert.strictEqual(exitCode, 1);
});

// present mode
test('present mode passes for non-empty actual', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'present', INPUT_EXPECTED: 'IGNORED', INPUT_ACTUAL: 'something' }));
  assert.strictEqual(exitCode, 0);
});

test('present mode fails for empty actual', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'present', INPUT_ACTUAL: '', INPUT_EXPECTED: 'IGNORED' }));
  assert.strictEqual(exitCode, 1);
});

// absent mode
test('absent mode passes for empty actual', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'absent', INPUT_ACTUAL: '', INPUT_EXPECTED: 'IGNORED' }));
  assert.strictEqual(exitCode, 0);
});

test('absent mode fails for non-empty actual', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'absent', INPUT_ACTUAL: 'present', INPUT_EXPECTED: 'IGNORED' }));
  assert.strictEqual(exitCode, 1);
});

// absent mode allows missing INPUT_ACTUAL entirely
test('absent mode passes when actual is missing (optional)', () => {
  const env = baseEnv({ INPUT_MODE: 'absent', INPUT_EXPECTED: 'IGNORED' });
  delete env.INPUT_ACTUAL;
  const { exitCode } = execAssertion(env);
  assert.strictEqual(exitCode, 0);
});

// regex simple (no delimiters)
test('regex mode matches plain pattern', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'regex', INPUT_EXPECTED: '^foo.*bar$', INPUT_ACTUAL: 'foo123bar' }));
  assert.strictEqual(exitCode, 0);
});

// regex with delimiters and flags
test('regex mode matches /pattern/i with flags', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'regex', INPUT_EXPECTED: '/^foo$/i', INPUT_ACTUAL: 'FOO' }));
  assert.strictEqual(exitCode, 0);
});

// invalid regex
test('regex mode invalid pattern fails', () => {
  const { exitCode, logs } = execAssertion(baseEnv({ INPUT_MODE: 'regex', INPUT_EXPECTED: '/[unterminated', INPUT_ACTUAL: 'anything' }));
  assert.strictEqual(exitCode, 1);
  assert.ok(logs.some(l => /Invalid regex/.test(l)));
});

// regex mismatch should fail (pass=false branch)
test('regex mode mismatch fails when pattern does not match', () => {
  const { exitCode } = execAssertion(baseEnv({ INPUT_MODE: 'regex', INPUT_EXPECTED: '^foo$', INPUT_ACTUAL: 'bar' }));
  assert.strictEqual(exitCode, 1);
});

// unknown mode
test('unknown mode exits with error', () => {
  const { exitCode, logs } = execAssertion(baseEnv({ INPUT_MODE: 'mystery', INPUT_EXPECTED: 'x', INPUT_ACTUAL: 'x' }));
  assert.strictEqual(exitCode, 1);
  assert.ok(logs.some(l => /Unknown mode/.test(l)));
});

// missing required env var
test('missing expected env causes exit 1', () => {
  const env = baseEnv({});
  delete env.INPUT_EXPECTED; // required
  const { exitCode, logs } = execAssertion(env);
  assert.strictEqual(exitCode, 1);
  assert.ok(logs.some(l => /Missing required env var: INPUT_EXPECTED/.test(l)));
});

// expected may be empty string but must be defined
test('expected can be empty string (defined) and exact mode compares against empty', () => {
  const { exitCode, summary } = execAssertion(baseEnv({ INPUT_EXPECTED: '', INPUT_ACTUAL: '', INPUT_MODE: 'exact' }));
  assert.strictEqual(exitCode, 0);
  assert.match(summary, /PASS: Test Name/);
});

// summary aggregation (multiple passes append)
test('summary file aggregates multiple results', () => {
  const env1 = baseEnv({ INPUT_EXPECTED: 'a', INPUT_ACTUAL: 'a', INPUT_TEST_NAME: 'T1' });
  const env2 = baseEnv({ INPUT_EXPECTED: 'b', INPUT_ACTUAL: 'b', INPUT_TEST_NAME: 'T2' });
  const sumFile = env1.INPUT_SUMMARY_FILE; // reuse
  env2.INPUT_SUMMARY_FILE = sumFile;
  const r1 = execAssertion(env1);
  const r2 = execAssertion(env2);
  const content = fs.readFileSync(sumFile, 'utf8');
  assert.match(content, /PASS: T1/);
  assert.match(content, /PASS: T2/);
  assert.strictEqual(r1.exitCode, 0);
  assert.strictEqual(r2.exitCode, 0);
});

// exit-on-fail causes immediate exit and no PASS line
test('exit-on-fail stops after failure and exits 1', () => {
  const env = baseEnv({ INPUT_EXPECTED: 'foo', INPUT_ACTUAL: 'bar', INPUT_EXIT_ON_FAIL: 'true', INPUT_TEST_NAME: 'FailFast' });
  const { exitCode, summary } = execAssertion(env);
  assert.strictEqual(exitCode, 1);
  assert.match(summary, /FAIL: FailFast/);
  assert.doesNotMatch(summary, /PASS: FailFast/);
});

// ensure summary directory is created if missing
test('creates summary directory when it does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-sum-'));
  const nested = path.join(dir, 'deep', 'more', 'summary.txt');
  const env = baseEnv({ INPUT_EXPECTED: 'x', INPUT_ACTUAL: 'x', INPUT_SUMMARY_FILE: nested, INPUT_TEST_NAME: 'NestedPass' });
  const { exitCode, summary } = execAssertion(env);
  assert.strictEqual(exitCode, 0);
  assert.ok(fs.existsSync(nested));
  assert.match(summary, /PASS: NestedPass/);
});

