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
});

test('normalizeToPosix converts backslashes', () => {
  assert.strictEqual(normalizeToPosix('a\\b\\c'), 'a/b/c');
});

test('computeRelative cases from spec', () => {
  const root = './demo/coding-standards/Coding.Standards.sln';
  const sep = path.sep;
  const expOne = ['..', ''].join(sep); // one level up with trailing sep
  const expTwo = ['..', '..', ''].join(sep); // two levels up with trailing sep
  assert.strictEqual(computeRelative(root, './demo/coding-standards/src/Coding.Standards.csproj'), expOne);
  assert.strictEqual(computeRelative(root, './demo/coding-standards/src/subdir/Coding.Standards.csproj'), expTwo);
  assert.strictEqual(computeRelative(root, './demo/coding-standards/tests/subdir2/Coding.Standards.Tests.csproj'), expTwo);
  assert.strictEqual(computeRelative(root, '["./demo/coding-standards/src/Coding.Standards.csproj"]'), expOne);
  assert.strictEqual(computeRelative(root, '["./demo/coding-standards/src/subdir/Coding.Standards.csproj"]'), expTwo);
  assert.strictEqual(computeRelative(root, '["./demo/coding-standards/tests/subdir2/Coding.Standards.Tests.csproj"]'), expTwo);
});

test('computeRelative throws on comma', () => {
  assert.throws(() => computeRelative('a,b', 'x'), /comma/);
  assert.throws(() => computeRelative('a', 'x,y'), /comma/);
});

test('run writes to GITHUB_OUTPUT and stdout', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rel-'));
  const out = path.join(tmp, 'out.txt');
  const { out: stdout } = withEnv({
    INPUT_ROOT_FILE: './demo/coding-standards/Coding.Standards.sln',
    INPUT_SUBDIRECTORY_FILE: './demo/coding-standards/src/Coding.Standards.csproj',
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

test('computeRelative cases from spec (platform-aware)', () => {
  const root = './demo/coding-standards/Coding.Standards.sln';
  const one = computeRelative(root, '.\\demo\\coding-standards\\src\\Coding.Standards.csproj');
  const two = computeRelative(root, '.\\demo\\coding-standards\\src\\subdir\\Coding.Standards.csproj');
  const three = computeRelative(root, '.\\demo\\coding-standards\\tests\\subdir2\\Coding.Standards.Tests.csproj');
  const threeBracket = computeRelative('[.\\demo\\coding-standards\\Coding.Standards.sln]', '[.\\demo\\coding-standards\\tests\\subdir2\\Coding.Standards.Tests.csproj]');
  const sep = path.sep;
  // one level has trailing sep; two and three are two levels up with trailing sep
  assert.strictEqual(one, ['..', ''].join(sep)); // '../' or '..\'
  assert.strictEqual(two, ['..','..',''].join(sep)); // '../..' + sep or '..\..'
  assert.strictEqual(three, two);
  assert.strictEqual(threeBracket, three);
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
