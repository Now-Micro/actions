// Run with coverage: 
// npx c8 node --test get-project-and-solution-files-from-directory/get-project-and-solution-files-from-directory.test.js

// Comprehensive tests for get-project-and-solution-files-from-directory.js
// Covers BFS shallow preference, DFS legacy walk, depth limiting, error paths, debug logging, and output writing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPT_PATH = path.join(__dirname, 'get-project-and-solution-files-from-directory.js');
const mod = require('./get-project-and-solution-files-from-directory.js');

// Utility: create temp directory
function makeTempDir(prefix = 'finder-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Utility: capture stdout/stderr during a function
function capture(fn) {
  const logs = { out: '', err: '' };
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (chunk, enc, cb) => { logs.out += chunk; return true; };
  process.stderr.write = (chunk, enc, cb) => { logs.err += chunk; return true; };
  try { fn(); } finally { process.stdout.write = origOut; process.stderr.write = origErr; }
  return logs;
}

// Utility: run script run() with env overrides, capturing output
function runWithEnv(env) {
  const prev = { ...process.env };
  Object.keys(process.env).filter(k => k.startsWith('INPUT_')).forEach(k => delete process.env[k]);
  const provided = env || {};
  Object.entries(provided).forEach(([k,v]) => process.env[k] = v);
  const hadGithubOutputKey = Object.prototype.hasOwnProperty.call(provided, 'GITHUB_OUTPUT');
  if (hadGithubOutputKey) {
    if (provided.GITHUB_OUTPUT === '__UNSET__' || provided.GITHUB_OUTPUT === '') {
      delete process.env.GITHUB_OUTPUT; // simulate missing
    }
  }
  let outputFile;
  if (!hadGithubOutputKey) { // only auto-create when not explicitly provided
    outputFile = fs.mkdtempSync(path.join(os.tmpdir(), 'github-output-')) + '/out.txt';
    fs.writeFileSync(outputFile, '');
    process.env.GITHUB_OUTPUT = outputFile;
  }
  let exitCode;
  const origExit = process.exit;
  process.exit = (code) => { exitCode = code; throw new Error(`process.exit:${code}`); };
  const logs = { out: '', err: '' };
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (chunk, enc, cb) => { logs.out += chunk; return true; };
  process.stderr.write = (chunk, enc, cb) => { logs.err += chunk; return true; };
  let errorObj;
  try {
    mod.run();
    exitCode = exitCode === undefined ? 0 : exitCode;
  } catch (e) {
    if (/^process.exit:/.test(e.message)) {
      // process.exit path; exitCode already set
    } else {
      errorObj = e;
    }
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exit = origExit;
    Object.keys(process.env).forEach(k => { if (!(k in prev)) delete process.env[k]; });
    Object.entries(prev).forEach(([k,v]) => process.env[k] = v);
  }
  const outPath = hadGithubOutputKey ? process.env.GITHUB_OUTPUT : outputFile;
  let outputContent = '';
  if (outPath && fs.existsSync(outPath) && fs.statSync(outPath).isFile()) {
    outputContent = fs.readFileSync(outPath, 'utf8');
  }
  return { logs, exitCode, outputContent, errorObj, outputFile: outPath };
}

// 1. Basic both solution + project found, BFS prefers shallow project.
test('BFS finds shallow solution and project first', () => {
  const dir = makeTempDir();
  const shallowProj = path.join(dir, 'AppA.csproj');
  const solution = path.join(dir, 'Sample.sln');
  fs.writeFileSync(shallowProj, '<Project></Project>');
  fs.writeFileSync(solution, 'Microsoft Visual Studio Solution File');
  const deepDir = path.join(dir, 'deep', 'nest');
  fs.mkdirSync(deepDir, { recursive: true });
  const deepProj = path.join(deepDir, 'Deep.csproj');
  fs.writeFileSync(deepProj, '<Project></Project>');

  const { logs, exitCode, outputContent } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '5',
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'true',
    INPUT_DEBUG_MODE: 'false'
  });
  assert.strictEqual(exitCode, 0);
  assert.match(logs.out, /Project found: .*AppA.csproj/); // shallow
  assert.match(logs.out, /Solution found: .*Sample.sln/);
  assert.match(outputContent, /solution-found=.*Sample.sln/);
  assert.match(outputContent, /project-found=.*AppA.csproj/);
  // New outputs
  assert.match(outputContent, /solution-name=Sample\.sln/);
  assert.match(outputContent, /project-name=AppA\.csproj/);
  assert.doesNotMatch(logs.out, /Deep.csproj/); // deep project not chosen first
});

// 2. Only solution search
test('Only solution search writes only solution output', () => {
  const dir = makeTempDir();
  const solution = path.join(dir, 'Only.sln');
  fs.writeFileSync(solution, 'Solution');
  const { exitCode, outputContent } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '1',
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'false'
  });
  assert.strictEqual(exitCode, 0);
  assert.match(outputContent, /solution-found=.*Only\.sln/);
  assert.match(outputContent, /solution-name=Only\.sln/);
  assert.ok(!/project-found=/.test(outputContent));
  assert.ok(!/project-name=/.test(outputContent));
});

// 3. Only project search
test('Only project search writes only project output', () => {
  const dir = makeTempDir();
  const proj = path.join(dir, 'Only.csproj');
  fs.writeFileSync(proj, '<Project></Project>');
  const { exitCode, outputContent } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '1',
    INPUT_FIND_SOLUTION: 'false',
    INPUT_FIND_PROJECT: 'true'
  });
  assert.strictEqual(exitCode, 0);
  assert.match(outputContent, /project-found=.*Only\.csproj/);
  assert.match(outputContent, /project-name=Only\.csproj/);
  assert.ok(!/solution-found=/.test(outputContent));
  assert.ok(!/solution-name=/.test(outputContent));
});

// 4. None found scenario (empty directory)
test('No files found results in no outputs written', () => {
  const dir = makeTempDir();
  const { exitCode, outputContent, logs } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '2',
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'true'
  });
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(outputContent.trim(), '');
  assert.match(logs.out, /Project found: None/);
  assert.match(logs.out, /Solution found: None/);
});

// 5. Depth limit prevents detection
test('Depth limit prevents deeper discovery', () => {
  const dir = makeTempDir();
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'Deep.sln'), 'Solution');
  const { exitCode, outputContent, logs } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '0', // only root searched
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'true'
  });
  assert.strictEqual(exitCode, 0);
  assert.strictEqual(outputContent.trim(), '');
  assert.match(logs.out, /Searching for .* in .* \(max depth: 0\)\.\.\./);
});

// 6. Missing directory error
test('Missing directory triggers exit 1', () => {
  const missing = path.join(os.tmpdir(), 'definitely-missing-dir-' + Date.now());
  const { exitCode, logs } = runWithEnv({
    INPUT_DIRECTORY: missing,
    INPUT_MAX_DEPTH: '1',
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'true'
  });
  assert.strictEqual(exitCode, 1);
  assert.match(logs.err + logs.out, /does not exist or is not a directory/);
});

// 7. Blank directory input error
test('Blank directory input triggers required error', () => {
  const { exitCode, logs } = runWithEnv({
    INPUT_DIRECTORY: '',
    INPUT_MAX_DEPTH: '1',
    INPUT_FIND_SOLUTION: 'true',
    INPUT_FIND_PROJECT: 'true'
  });
  assert.strictEqual(exitCode, 1);
  assert.match(logs.err + logs.out, /Input directory is required/);
});

// 8. GITHUB_OUTPUT not set -> exit 1
test('Missing GITHUB_OUTPUT causes exit 1', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'X.csproj'), '<Project></Project>');
  const { exitCode, logs } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '1',
    INPUT_FIND_SOLUTION: 'false',
    INPUT_FIND_PROJECT: 'true',
    GITHUB_OUTPUT: '__UNSET__' // signal helper to NOT create a file & simulate missing
  });
  assert.strictEqual(exitCode, 1);
  assert.match(logs.err + logs.out, /GITHUB_OUTPUT not set/);
});

// 9. Debug mode logs
test('Debug mode emits [DEBUG] lines', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'Y.csproj'), '<Project></Project>');
  const { logs, exitCode } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '2',
    INPUT_FIND_SOLUTION: 'false',
    INPUT_FIND_PROJECT: 'true',
    INPUT_DEBUG_MODE: 'true'
  });
  assert.strictEqual(exitCode, 0);
  assert.match(logs.out, /\[DEBUG]/);
});

// 10. BFS handles unreadable subdirectory gracefully
test('BFS continues after unreadable subdirectory', () => {
  const dir = makeTempDir();
  const blocked = path.join(dir, 'blocked');
  const ok = path.join(dir, 'ok');
  fs.mkdirSync(blocked);
  fs.mkdirSync(ok);
  fs.writeFileSync(path.join(ok, 'Z.csproj'), '<Project></Project>');
  const orig = fs.readdirSync;
  let threw = false;
  fs.readdirSync = function(p, opts) { if (p === blocked) { threw = true; throw new Error('EACCES'); } return orig(p, opts); };
  const { logs, exitCode } = runWithEnv({
    INPUT_DIRECTORY: dir,
    INPUT_MAX_DEPTH: '2',
    INPUT_FIND_SOLUTION: 'false',
    INPUT_FIND_PROJECT: 'true'
  });
  fs.readdirSync = orig;
  assert.ok(threw, 'Mock should have thrown');
  assert.strictEqual(exitCode, 0); // still success because write outputs
  assert.match(logs.err + logs.out, /Cannot read directory: .*blocked/);
});

// 11. Legacy DFS walk coverage
test('Legacy DFS walk finds files (coverage)', () => {
  const dir = makeTempDir();
  fs.writeFileSync(path.join(dir, 'Legacy.sln'), 'Solution');
  fs.writeFileSync(path.join(dir, 'Legacy.csproj'), '<Project></Project>');
  // Capture output during walk
  const logs = capture(() => mod.walk(dir, 1, true, true));
  assert.match(logs.out, /Found solution: .*Legacy.sln/);
  assert.match(logs.out, /Found project: .*Legacy.csproj/);
});

// 12. DFS walk respects maxDepth early exit
test('DFS walk maxDepth prevents deeper scanning', () => {
  const dir = makeTempDir();
  const deep = path.join(dir, 'deep');
  fs.mkdirSync(deep);
  fs.writeFileSync(path.join(deep, 'DeepOnly.csproj'), '<Project></Project>');
  const logs = capture(() => mod.walk(dir, 0, false, true));
  // Should not find project because depth starts at 0 and > maxDepth avoided but recursion not entered
  assert.doesNotMatch(logs.out, /Found project/);
});

// 13. Use real demo/coding-standards structure with relative directory input
{
  const repoRoot = path.resolve(__dirname, '..');
  const demoAbs = path.resolve(repoRoot, 'demo', 'coding-standards');
  const demoRel = process.platform === 'win32' ? '.\\demo\\coding-standards' : './demo/coding-standards';
  const present = fs.existsSync(demoAbs);
  test('Demo coding-standards directory yields solution and project (relative path input)', { skip: !present }, () => {
    const { exitCode, outputContent } = runWithEnv({
      INPUT_DIRECTORY: demoRel,
      INPUT_MAX_DEPTH: '6',
      INPUT_FIND_SOLUTION: 'true',
      INPUT_FIND_PROJECT: 'true'
    });
    assert.strictEqual(exitCode, 0);
    assert.match(outputContent, /solution-found=.*Demo\.Linting\.sln/);
    // Either Demo.Linting.csproj or Demo.Analyzers.csproj may be chosen first by BFS
    assert.match(outputContent, /project-found=.*(Demo\.Linting\.csproj|Demo\.Analyzers\.csproj)/);
  });
}
