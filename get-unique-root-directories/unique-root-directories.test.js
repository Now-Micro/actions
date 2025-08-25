const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('./unique-root-directories');

const LINTING_REGEX = '^([^/.]+)\/';
const TESTING_REGEX = '^([^\/]+)\/(src|tests?)\/.*\.(cs|csproj|sln)$'

function withEnv(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  const showLogs = true;
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
  let out = '', err = '';
  const so = process.stdout.write, se = process.stderr.write;
  if (showLogs) {
    // Mirror output to console while capturing
    process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
    process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
  } else {
    // Suppress console output, capture silently
    process.stdout.write = (c, e, cb) => { out += c; return true; };
    process.stderr.write = (c, e, cb) => { err += c; return true; };
  }
  try {
    try { fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
  } finally {
    process.env = prev;
    process.exit = origExit;
    process.stdout.write = so;
    process.stderr.write = se;
  }
  return { exitCode, out, err };
}

function runWith(env) {
  // Replace local repo tmp file with an OS temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'urd-'));
  const tmpOut = path.join(tmpDir, 'output.txt');
  fs.writeFileSync(tmpOut, '');
  const r = withEnv({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
  r.outputFile = tmpOut;
  r.outputContent = fs.readFileSync(tmpOut, 'utf8');
  return r;
}

function logHeader(name, pattern, paths) {
  const max = 280;
  const preview = paths && paths.length > max ? paths.slice(0, max) + '…' : paths;
  console.log(`\n===== ${name} =====`);
  if (pattern !== undefined) console.log(`Pattern: ${pattern}`);
  if (preview !== undefined) console.log(`Paths: ${preview}`);
}

// 1 valid extraction
test('extracts unique roots', () => {
  const pattern = '^(src/[^/]+)/';
  const paths = 'src/Api/Program.cs,src/Api/Controllers/Home.cs,src/Lib/Util.cs';
  logHeader('extracts unique roots', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.out, /Api/);
  assert.match(r.out, /Lib/);
  assert.match(r.outputContent, /unique_root_directories=\["src\/Api","src\/Lib"\]/);
});

// 2 no matches
test('no matches writes empty array', () => {
  const pattern = '^(foo)/';
  const paths = 'src/Api/Program.cs';
  logHeader('no matches writes empty array', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.out, /\[\]/);
  assert.match(r.outputContent, /unique_root_directories=\[\]/);
});

// 3 invalid regex
test('invalid regex exits 1', () => {
  const pattern = '([unclosed';
  const paths = 'a,b';
  logHeader('invalid regex exits 1', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.err + r.out, /Invalid regex/);
});

// 4 missing pattern
test('missing pattern exits 1', () => {
  const paths = 'a,b';
  logHeader('missing pattern exits 1', '(missing)', paths);
  const r = runWith({ INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.err + r.out, /INPUT_PATTERN is required/);
});

// 5 missing GITHUB_OUTPUT
test('missing GITHUB_OUTPUT exits 1', () => {
  const pattern = '^(.*)$';
  const paths = 'a,b';
  logHeader('missing GITHUB_OUTPUT exits 1', pattern, paths);
  const r = withEnv({ INPUT_PATTERN: pattern, INPUT_PATHS: paths, GITHUB_OUTPUT: '' }, () => run());
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.err + r.out, /GITHUB_OUTPUT not set/);
});

// 6 duplicate handling (ensure uniqueness)
test('duplicates only logged once', () => {
  const pattern = '^(src/Api)/';
  const paths = 'src/Api/One.cs,src/Api/Two.cs';
  logHeader('duplicates only logged once', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 1);
});

// multiple duplicates
test('multiple duplicates across three unique roots', () => {
  const pattern = '^(src/[^/]+)/';
  const paths = [
    'src/Api/Program.cs',
    'src/Api/Program.cs',
    'src/Api/Controllers/Home.cs',
    'src/Lib/Lib.cs',
    'src/Lib/Lib.cs',
    'src/Util/Helper.cs',
    'src/Util/Helper.cs',
    'src/Util/Another.cs'
  ].join(',');
  logHeader('multiple duplicates across three unique roots', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["src\/Api","src\/Lib","src\/Util"\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 3);
});

// testing regex variants
test('testing regex - matches src/test/tests variants', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    'ProjectA/src/Program.cs','ProjectA/src/Utils/Helper.cs',
    'ProjectB/test/ProjectB.csproj','ProjectB/tests/Another.cs',
    'ProjectC/tests/Solution.sln','ProjectC/test/Other.cs',
    'My-App/src/Util.cs','My.App/tests/Suite.sln',
    'ProjectD/lib/Program.cs','ProjectE/src/README.md','/ProjectF/src/Program.cs','ProjectG/tests/Program.txt',
    'ProjectH/src/Dir','ProjectI/tests/Program.csx'
  ].join(',');
  logHeader('testing regex - matches src/test/tests variants', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["ProjectA","ProjectB","ProjectC","My-App","My.App"\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 5);
});

// no matches complex pattern
test('testing regex: no matches returns empty array', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    'Alpha/lib/File.cs','Beta/source/Program.cs','Gamma/src/Readme.md','/Delta/src/Program.cs','Epsilon/tests/Notes.txt','Zeta/src/Folder'
  ].join(',');
  logHeader('testing regex: no matches returns empty array', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\[\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 0);
});

// linting pattern main success
test('Linting pattern: extracts valid roots', () => {
  const pattern = LINTING_REGEX;
  const paths = [
    'Alpha/src/File.cs','Beta/tests/Test.cs','Alpha/docs/Readme.md','Gamma/one/two/three.txt','Bad.Root/src/File.cs','.hidden/src/File.cs','delta/',
    'epsilon','foo.bar/','my-app/src/index.cs','my_app/src/index.cs','Zeta/Another.cs','Alpha/more/Deeper.cs','  Beta/space.cs'
  ].join(',');
  logHeader('Linting pattern: extracts valid roots', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["Alpha","Beta","Gamma","delta","my-app","my_app","Zeta"\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 7);
});

// linting duplicates
test('Linting pattern: duplicates only logged once per root', () => {
  const pattern = LINTING_REGEX;
  const paths = ['Proj/one.cs','Proj/two.cs','Proj/three.cs','Other/file.cs','Other/file2.cs'].join(',');
  logHeader('Linting pattern: duplicates only logged once per root', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["Proj","Other"\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 2);
});

// linting no matches
test('Linting pattern: no matches', () => {
  const pattern = LINTING_REGEX;
  const paths = ['.hidden','with.dot','.hidden/file','bad.root/file','onlyfile','/leading/slash/file'].join(',');
  logHeader('Linting pattern: no matches', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\[\]/);
  const occurrences = (r.out.match(/Unique Root Directory found/g) || []).length;
  assert.strictEqual(occurrences, 0);
});

// complex regex de-duplicate root
test('complex regex: de-duplicates single root', () => {
  const pattern = TESTING_REGEX;
  const paths = ['ProjMix/src/Main.cs','ProjMix/tests/Unit/Spec.cs','ProjMix/test/ProjMix.csproj','ProjMix/src/Nested/More/App.sln'].join(',');
  logHeader('complex regex: de-duplicates single root', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["ProjMix"\]/);
});

// complex regex mixed
test('complex regex: mixed unrelated valid and invalid roots', () => {
  const pattern = TESTING_REGEX;
  const paths = ['A/src/A.cs','B/tests/BSpec.cs','C/test/C.csproj','D/src/D.sln','E/lib/E.cs','F/tests/readme.md','G/src/file.CS','Hsrc/Not/Really.cs','I/tes/Almost.cs','J/src/deep/file.cs'].join(',');
  logHeader('complex regex: mixed unrelated valid and invalid roots', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["A","B","C","D","J"\]/);
});

// complex regex backslashes
test('complex regex: backslash path separators do not match', () => {
  const pattern = TESTING_REGEX;
  const paths = ['WinProj\\src\\Program.cs','RealProj/src/Program.cs'].join(',');
  logHeader('complex regex: backslash path separators do not match', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["RealProj"\]/);
});

// complex regex whitespace
test('complex regex: whitespace handling', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    '  Solution1/src/Api/Program.cs','   Solution1/src/Api/Program.cs','     Solution1/src/Api/Controllers/Home.cs','     Solution1/src/Lib/Lib.cs','   Solution1/src/Lib/Lib.cs','       Solution1/src/Util/Helper.cs','     Solution1/src/Util/Helper.cs',' Solution1/src/Util/Another.cs','     Solution2/tests/Util/Another.cs','   Solution3/tests/Test.cs',' SkipSolution1/example/tests/README.md','  SkipSolution2/src/Api/README.md','     SkipSolution3/README.md'
  ].join(',');
  logHeader('complex regex: whitespace handling', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["Solution1","Solution2","Solution3"\]/);
});

// extra characters test
test('testing extra characters', () => {
  const pattern = TESTING_REGEX;
  const paths = ['[".github/workflows/checks.yml"','["ChannelOnline/tests/Trafera.ChannelOnline.Tests/GlobalUsings.cs"]'].join(',');
  logHeader('testing extra characters', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=\["ChannelOnline"\]/);
});


test('testing out is not json 1', () => {
  const pattern = TESTING_REGEX;
  const paths = ['[".github/workflows/checks.yml"','["ChannelOnline/tests/Trafera.ChannelOnline.Tests/GlobalUsings.cs"]'].join(',');
  logHeader('testing extra characters', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: 'false' });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=ChannelOnline/);
});

test('testing out is not json 2', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    '  Solution1/src/Api/Program.cs','   Solution1/src/Api/Program.cs','     Solution1/src/Api/Controllers/Home.cs','     Solution1/src/Lib/Lib.cs','   Solution1/src/Lib/Lib.cs','       Solution1/src/Util/Helper.cs','     Solution1/src/Util/Helper.cs',' Solution1/src/Util/Another.cs','     Solution2/tests/Util/Another.cs','   Solution3/tests/Test.cs',' SkipSolution1/example/tests/README.md','  SkipSolution2/src/Api/README.md','     SkipSolution3/README.md'
  ].join(',');
  logHeader('complex regex: whitespace handling', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: 'false' });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=Solution1,Solution2,Solution3/);
});

test('testing out is not json 2', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    '  Solution1/src/Api/Program.cs','   Solution1/src/Api/Program.cs','     Solution1/src/Api/Controllers/Home.cs','     Solution1/src/Lib/Lib.cs','   Solution1/src/Lib/Lib.cs','       Solution1/src/Util/Helper.cs','     Solution1/src/Util/Helper.cs',' Solution1/src/Util/Another.cs','     Solution2/tests/Util/Another.cs','   Solution3/tests/Test.cs',' SkipSolution1/example/tests/README.md','  SkipSolution2/src/Api/README.md','     SkipSolution3/README.md'
  ].join(',');
  logHeader('complex regex: whitespace handling', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: 'false' });
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=Solution1,Solution2,Solution3/);
});

test('inputs can handle booleans too', () => {
  const pattern = TESTING_REGEX;
  const paths = [
    '  Solution1/src/Api/Program.cs','   Solution1/src/Api/Program.cs','     Solution1/src/Api/Controllers/Home.cs','     Solution1/src/Lib/Lib.cs','   Solution1/src/Lib/Lib.cs','       Solution1/src/Util/Helper.cs','     Solution1/src/Util/Helper.cs',' Solution1/src/Util/Another.cs','     Solution2/tests/Util/Another.cs','   Solution3/tests/Test.cs',' SkipSolution1/example/tests/README.md','  SkipSolution2/src/Api/README.md','     SkipSolution3/README.md'
  ].join(',');
  logHeader('complex regex: whitespace handling', pattern, paths);
  const r = runWith({ INPUT_PATTERN: pattern, INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: false});
  assert.strictEqual(r.exitCode, 0);
  assert.match(r.outputContent, /unique_root_directories=Solution1,Solution2,Solution3/);
});