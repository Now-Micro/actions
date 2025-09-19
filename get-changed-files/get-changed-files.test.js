const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { test, beforeEach, afterEach } = require('node:test');
const { run, ensureCommitExists, extractSha } = require('./get-changed-files');
const { execSync } = require('child_process');

// Utility: create an isolated git repository with initial commit
function initRepo(structureFn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-files-action-'));
  const prevCwd = process.cwd();
  process.chdir(dir);
  execSync('git init -q');
  execSync('git config user.email "ci@example.com"');
  execSync('git config user.name "CI Bot"');
  structureFn(dir);
  return { dir, prevCwd };
}

function writeFile(relPath, content) {
  fs.mkdirSync(path.dirname(relPath), { recursive: true });
  fs.writeFileSync(relPath, content);
  execSync(`git add "${relPath}"`);
}

function commit(message) {
  execSync(`git commit -q -m "${message}"`);
  return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
}

// Capture console output helper
function captureRun(envOverrides = {}) {
  const logs = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));

  const outputFile = path.join(os.tmpdir(), `gh-output-${Date.now()}-${Math.random()}.txt`);
  const originalEnv = { ...process.env };
  process.env.GITHUB_OUTPUT = outputFile;
  Object.entries(envOverrides).forEach(([k, v]) => (process.env[k] = v));

  // Monkey-patch process.exit to throw for test assertions
  const origExit = process.exit;
  let exitCode = null;
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`__process_exit__${code}`);
  };

  try {
    run();
  } catch (e) {
    if (!/^__process_exit__/.test(e.message)) {
      // rethrow unexpected error
      throw e;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    process.exit = origExit;
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.entries(originalEnv).forEach(([k, v]) => (process.env[k] = v));
  }

  const output = fs.existsSync(outputFile)
    ? fs.readFileSync(outputFile, { encoding: 'utf8' })
    : '';

  return { logs, output, exitCode };
}

let context;

beforeEach(() => {
  context = initRepo(() => { }); // empty repo initialization
});

afterEach(() => {
  process.chdir(context.prevCwd);
  try { fs.rmSync(context.dir, { recursive: true, force: true }); } catch { }
});

// Test: no changes when base == head
test('outputs empty array when there are no changes', () => {
  writeFile('README.md', 'base file');
  const baseSha = commit('base commit');
  // No new commits; head == base
  const { output } = captureRun({ INPUT_BASE_REF: baseSha, INPUT_HEAD_REF: baseSha });
  assert.match(output, /changed_files=\[\]/);
});

// Test: diff between two commits returns expected file
test('detects changed files between base and head', () => {
  writeFile('a.txt', 'one');
  const baseSha = commit('base commit');
  writeFile('b.txt', 'two');
  const headSha = commit('head commit');
  const { output } = captureRun({ INPUT_BASE_REF: baseSha, INPUT_HEAD_REF: headSha });
  // Output line should contain JSON array with b.txt (a.txt unchanged after base)
  assert.match(output, /changed_files=\[("b.txt"|"a.txt","b.txt"|"b.txt","a.txt")/);
});

// Test: only base provided uses HEAD
test('falls back to HEAD when only base provided', () => {
  writeFile('file1.cs', 'x');
  const baseSha = commit('base commit');
  writeFile('file2.cs', 'y');
  commit('second commit');
  const { output } = captureRun({ INPUT_BASE_REF: baseSha, INPUT_HEAD_REF: '' });
  assert.match(output, /file2.cs/);
});

// Test: invalid base sha triggers error exit
test('exits with error on invalid base sha', () => {
  // create a valid head commit so HEAD exists
  writeFile('ok.txt', 'ok');
  commit('head');
  const { exitCode, logs } = captureRun({ INPUT_BASE_REF: 'deadbeef', INPUT_HEAD_REF: '' });
  assert.strictEqual(exitCode, 1, 'process should exit with code 1');
  assert.ok(logs.some(l => /Base SHA deadbeef not found/.test(l)), 'should log missing base SHA');
});

// Test: ensureCommitExists returns false for unknown sha
test('ensureCommitExists returns false for unknown sha', () => {
  const result = ensureCommitExists('ffffffff', '');
  assert.strictEqual(result, false);
});

// Test: ensureCommitExists fetches missing branch from origin
test('ensureCommitExists fetches missing branch from origin', () => {
  // Create remote bare repository with a branch that does not exist locally
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-base-'));
  const bare = path.join(tmpBase, 'remote.git');
  execSync(`git init --bare -q "${bare}"`);
  const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-work-'));
  execSync(`git clone -q "${bare}" "${remoteWork}"`);
  execSync('git config user.email "ci@example.com"', { cwd: remoteWork });
  execSync('git config user.name "CI Bot"', { cwd: remoteWork });
  fs.writeFileSync(path.join(remoteWork, 'seed.txt'), 'seed');
  execSync('git add seed.txt', { cwd: remoteWork });
  execSync('git commit -q -m "seed"', { cwd: remoteWork });
  // create new branch
  execSync('git checkout -q -b newbranch', { cwd: remoteWork });
  fs.writeFileSync(path.join(remoteWork, 'only-remote.txt'), 'remote');
  execSync('git add only-remote.txt', { cwd: remoteWork });
  execSync('git commit -q -m "remote branch commit"', { cwd: remoteWork });
  execSync('git push -q origin newbranch', { cwd: remoteWork });
  const remoteSha = execSync('git rev-parse HEAD', { cwd: remoteWork, encoding: 'utf8' }).trim();

  // Local test repo currently has no remote and cannot resolve remoteSha yet
  execSync(`git remote add origin "${bare.replace(/\\/g, '/')}"`); // add remote to local repo

  const ok = ensureCommitExists(remoteSha, '');
  assert.strictEqual(ok, true, 'should fetch remote commit SHA from origin successfully');
});

// Test: ensureCommitExists fetches PR ref when provided prNumber
test('ensureCommitExists fetches PR ref for provided pr number', () => {
  const prNumber = '123';
  // Setup bare remote with a commit and a pull ref
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-pr-'));
  const bare = path.join(tmpBase, 'remote.git');
  execSync(`git init --bare -q "${bare}"`);
  const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-pr-work-'));
  execSync(`git clone -q "${bare}" "${remoteWork}"`);
  execSync('git config user.email "ci@example.com"', { cwd: remoteWork });
  execSync('git config user.name "CI Bot"', { cwd: remoteWork });
  fs.writeFileSync(path.join(remoteWork, 'pr.txt'), 'pr');
  execSync('git add pr.txt', { cwd: remoteWork });
  execSync('git commit -q -m "pr seed"', { cwd: remoteWork });
  const prSha = execSync('git rev-parse HEAD', { cwd: remoteWork, encoding: 'utf8' }).trim();
  // Create the pull request ref
  execSync(`git update-ref refs/pull/${prNumber}/head ${prSha}`, { cwd: remoteWork });
  execSync(`git push -q origin refs/pull/${prNumber}/head`, { cwd: remoteWork });

  // Add remote to local test repo
  execSync(`git remote add origin "${bare.replace(/\\/g, '/')}"`);

  const ok = ensureCommitExists(prSha, prNumber);
  assert.strictEqual(ok, true, 'should fetch commit via pull ref');
});

// New: extractSha resolves branch names locally
test('extractSha resolves local branch name', () => {
  // create base commit
  writeFile('base.txt', 'base');
  commit('base');
  // create feature branch with new commit
  execSync('git checkout -q -b feat/test');
  writeFile('feat.txt', 'feat');
  const featSha = commit('feat commit');

  const resolved = extractSha('feat/test', '');
  assert.strictEqual(resolved, featSha);
});

// New: extractSha resolves tag names locally
test('extractSha resolves local tag', () => {
  writeFile('t1.txt', 't1');
  const sha = commit('tag base');
  execSync('git tag v1');
  const resolved = extractSha('v1', '');
  assert.strictEqual(resolved, sha);
});

// New: extractSha fetches remote branch then resolves
test('extractSha fetches and resolves remote branch', () => {
  // Setup bare remote with a branch not present locally
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-extract-'));
  const bare = path.join(tmpBase, 'remote.git');
  execSync(`git init --bare -q "${bare}"`);
  const remoteWork = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-extract-work-'));
  execSync(`git clone -q "${bare}" "${remoteWork}"`);
  execSync('git config user.email "ci@example.com"', { cwd: remoteWork });
  execSync('git config user.name "CI Bot"', { cwd: remoteWork });
  fs.writeFileSync(path.join(remoteWork, 'r.txt'), 'r');
  execSync('git add r.txt', { cwd: remoteWork });
  execSync('git commit -q -m "seed"', { cwd: remoteWork });
  execSync('git checkout -q -b feature/x', { cwd: remoteWork });
  fs.writeFileSync(path.join(remoteWork, 'x.txt'), 'x');
  execSync('git add x.txt', { cwd: remoteWork });
  execSync('git commit -q -m "x"', { cwd: remoteWork });
  const remoteSha = execSync('git rev-parse HEAD', { cwd: remoteWork, encoding: 'utf8' }).trim();
  execSync('git push -q origin feature/x', { cwd: remoteWork });

  // Link local repo to remote
  execSync(`git remote add origin "${bare.replace(/\\/g, '/')}"`);

  const resolved = extractSha('feature/x', '');
  assert.strictEqual(resolved, remoteSha, 'should resolve to remote branch head');
});

// New: run() accepts tag/branch inputs
test('run accepts branch and tag refs', () => {
  // base commit
  writeFile('a.txt', 'a');
  const baseSha = commit('base');
  execSync('git tag baseTag');
  // change on branch
  execSync('git checkout -q -b branch1');
  writeFile('b.txt', 'b');
  const headSha = commit('head');

  const { output } = captureRun({ INPUT_BASE_REF: 'baseTag', INPUT_HEAD_REF: 'branch1' });
  assert.match(output, /changed_files=\["b.txt"\]/);
});

// SanitizeRef coverage: unsafe patterns rejected
test('extractSha rejects unsafe ref: leading dash', () => {
  const resolved = extractSha('-bad', '');
  assert.strictEqual(resolved, '');
});

test('extractSha rejects unsafe ref: double dots', () => {
  const resolved = extractSha('feat..x', '');
  assert.strictEqual(resolved, '');
});

test('extractSha rejects unsafe ref: special @{ sequence', () => {
  const resolved = extractSha('main@{1}', '');
  assert.strictEqual(resolved, '');
});

test('extractSha rejects unsafe ref: double slash', () => {
  const resolved = extractSha('feature//x', '');
  assert.strictEqual(resolved, '');
});

test('extractSha rejects unsafe ref: trailing dot or slash', () => {
  assert.strictEqual(extractSha('bad.', ''), '');
  assert.strictEqual(extractSha('bad/', ''), '');
});

test('extractSha rejects unsafe ref: lock suffix and invalid chars', () => {
  assert.strictEqual(extractSha('refs/heads/bad.lock', ''), '');
  assert.strictEqual(extractSha('feat;rm -rf', ''), '');
  assert.strictEqual(extractSha('feat\\bad', ''), '');
});

test('run fails clearly on unsafe base ref', () => {
  // create a repo with at least one commit so run() environment is valid
  writeFile('x.txt', 'x');
  commit('init');
  const { exitCode, logs } = captureRun({ INPUT_BASE_REF: '-bad', INPUT_HEAD_REF: '' });
  assert.strictEqual(exitCode, 1);
  assert.ok(logs.some(l => /Could not resolve base ref '\-bad' to a commit SHA\./.test(l)));
});

test('extractSha accepts valid complex ref names', () => {
  // create base commit and a release branch
  writeFile('r.txt', 'r');
  commit('base');
  execSync('git checkout -q -b release/1.0.0');
  writeFile('rel.txt', 'rel');
  const relSha = commit('rel');
  const resolved = extractSha('release/1.0.0', '');
  assert.strictEqual(resolved, relSha);
});
