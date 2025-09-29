const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, computeRelative, sanitize, normalizeToPosix } = require('./relative-path-finder');

function withEnv(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  let out = '', err = '';
  const so = process.stdout.write, se = process.stderr.write;
  process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
  process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
  try { fn(); } finally { process.env = prev; process.stdout.write = so; process.stderr.write = se; }
  return { out, err };
}

test('sanitize strips brackets and trims', () => {
  assert.strictEqual(sanitize(' [abc] '), 'abc');
  assert.strictEqual(sanitize('[x]'), 'x');
  assert.strictEqual(sanitize('y'), 'y');
  assert.strictEqual(sanitize('["y/z"]'), 'y/z');
  assert.strictEqual(sanitize('["x/y/z"]'), 'x/y/z');
  assert.strictEqual(sanitize("'quoted'"), 'quoted');
  assert.strictEqual(sanitize('"double-quoted"'), 'double-quoted');
});

test('sanitize handles null and undefined', () => {
  assert.strictEqual(sanitize(null), '');
  assert.strictEqual(sanitize(undefined), '');
});

test('normalizeToPosix converts backslashes', () => {
  assert.strictEqual(normalizeToPosix('a\\b\\c'), 'a/b/c');
});

test('computeRelative cases from spec', () => {
  const root = './src/demo/coding-standards/Coding.Standards.sln';
  const sep = path.sep;
  const expOne = ['..', ''].join(sep); // one level up with trailing sep
  const expTwo = ['..', '..', ''].join(sep); // two levels up with trailing sep
  assert.strictEqual(computeRelative(root, './src/demo/coding-standards/src/Coding.Standards.csproj'), expOne);
  assert.strictEqual(computeRelative(root, './src/demo/coding-standards/src/subdir/Coding.Standards.csproj'), expTwo);
  assert.strictEqual(computeRelative(root, './src/demo/coding-standards/tests/subdir2/Coding.Standards.Tests.csproj'), expTwo);
  assert.strictEqual(computeRelative(root, '["./src/demo/coding-standards/src/Coding.Standards.csproj"]'), expOne);
  assert.strictEqual(computeRelative(root, '["./src/demo/coding-standards/src/subdir/Coding.Standards.csproj"]'), expTwo);
  assert.strictEqual(computeRelative(root, '["./src/demo/coding-standards/tests/subdir2/Coding.Standards.Tests.csproj"]'), expTwo);
});

test('computeRelative returns empty when in same directory', () => {
  const root = './src/demo/coding-standards/Coding.Standards.sln';
  const subSameDir = './src/demo/coding-standards/App.csproj';
  assert.strictEqual(computeRelative(root, subSameDir), '');
});

test('computeRelative returns empty when root is deeper than sub directory', () => {
  const deeperRoot = './src/demo/coding-standards/src/Coding.Standards.csproj';
  const higherSub = './src/demo/coding-standards/Coding.Standards.sln';
  assert.strictEqual(computeRelative(deeperRoot, higherSub), '');
});

test('computeRelative throws on comma', () => {
  assert.throws(() => computeRelative('a,b', 'x'), /comma/);
  assert.throws(() => computeRelative('a', 'x,y'), /comma/);
});

test('run writes to GITHUB_OUTPUT and stdout', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const out = path.join(tmp, 'out.txt');
  const { out: stdout } = withEnv({
    INPUT_ROOT_FILE: './src/demo/coding-standards/Coding.Standards.sln',
    INPUT_SUBDIRECTORY_FILE: './src/demo/coding-standards/src/Coding.Standards.csproj',
    GITHUB_OUTPUT: out
  }, () => run());
  const fileOut = fs.readFileSync(out, 'utf8');
  const sepRe = new RegExp(`\\.\\.${path.sep.replace('\\', '\\\\')}`);
  assert.match(stdout, sepRe); // '..' + sep
  assert.match(fileOut, new RegExp(`relative_path=\\.\\.${path.sep.replace('\\', '\\\\')}`));
});

test('run exits 1 on errors', () => {
  const origExit = process.exit;
  let code;
  process.exit = (c) => { code = c || 0; throw new Error(`__EXIT_${code}__`); };
  const r = withEnv({ INPUT_ROOT_FILE: 'a,b', INPUT_SUBDIRECTORY_FILE: 'x' }, () => {
    try { run(); } catch (e) { /* swallow sentinel */ }
  });
  process.exit = origExit;
  assert.strictEqual(code, 1);
  assert.match(r.err, /comma/);
});

test('run does not write output file when GITHUB_OUTPUT missing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const out = path.join(tmp, 'out.txt');
  const { out: stdout } = withEnv({
    INPUT_ROOT_FILE: './src/demo/coding-standards/Coding.Standards.sln',
    INPUT_SUBDIRECTORY_FILE: './src/demo/coding-standards/src/Coding.Standards.csproj'
  }, () => run());
  // stdout still has the relative path
  const sepRe = new RegExp(`\\.\\.${path.sep.replace('\\', '\\\\')}`);
  assert.match(stdout, sepRe);
  // and no output file was created
  assert.strictEqual(fs.existsSync(out), false);
});

test('run swallows GITHUB_OUTPUT append errors (directory path)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const outDir = path.join(tmp, 'outdir');
  fs.mkdirSync(outDir, { recursive: true });
  const { out: stdout } = withEnv({
    INPUT_ROOT_FILE: './src/demo/coding-standards/Coding.Standards.sln',
    INPUT_SUBDIRECTORY_FILE: './src/demo/coding-standards/src/Coding.Standards.csproj',
    GITHUB_OUTPUT: outDir // appendFileSync will throw; catch branch should swallow
  }, () => run());
  const sepRe = new RegExp(`\.\.${path.sep.replace('\\', '\\\\')}`);
  assert.match(stdout, sepRe);
  // Ensure still no file was written inside the directory by name (append ignored)
  // We only assert that run did not crash and directory still exists
  assert.strictEqual(fs.existsSync(outDir), true);
});

test('computeRelative cases from spec (platform-aware)', () => {
  const root = './src/demo/coding-standards/Coding.Standards.sln';
  const one = computeRelative(root, '.\\demo\\coding-standards\\src\\Coding.Standards.csproj');
  const two = computeRelative(root, '.\\demo\\coding-standards\\src\\subdir\\Coding.Standards.csproj');
  const three = computeRelative(root, '.\\demo\\coding-standards\\tests\\subdir2\\Coding.Standards.Tests.csproj');
  const threeBracket = computeRelative('[.\\demo\\coding-standards\\Coding.Standards.sln]', '[.\\demo\\coding-standards\\tests\\subdir2\\Coding.Standards.Tests.csproj]');
  const sep = path.sep;
  // one level has trailing sep; two and three are two levels up with trailing sep
  assert.strictEqual(one, ['..', ''].join(sep)); // '../' or '..\'
  assert.strictEqual(two, ['..', '..', ''].join(sep)); // '../..' + sep or '..\..'
  assert.strictEqual(three, two);
  assert.strictEqual(threeBracket, three);
});

test('computeRelative throws when inputs missing', () => {
  assert.throws(() => computeRelative('', './src/demo/file.csproj'), /required/);
  assert.throws(() => computeRelative('./src/demo/file.sln', ''), /required/);
});

// Ensure run uses platform separator
test('run writes to GITHUB_OUTPUT and stdout (platform-aware)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const out = path.join(tmp, 'out.txt');
  const { out: stdout } = withEnv({
    INPUT_ROOT_FILE: '.\\demo\\coding-standards\\Coding.Standards.sln',
    INPUT_SUBDIRECTORY_FILE: '.\\demo\\coding-standards\\src\\Coding.Standards.csproj',
    GITHUB_OUTPUT: out
  }, () => run());
  const sep = path.sep.replace('\\', '\\\\');
  const expStdout = new RegExp(`\\.\\.${sep}`); // '../' or '..\'
  assert.match(stdout, expStdout);
  const fileOut = fs.readFileSync(out, 'utf8');
  assert.match(fileOut, /relative_path=/);
});
