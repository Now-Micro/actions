const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, checkFile, collectYamlFiles, isExcludedPath, parseBool, parseList } = require('./enforce-action-shas');

const PINNED_SHA = 'de0fac2e4500dabe0009e67214ff5f5447ce83dd';

function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
    process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
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

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-shas-'));
}

function writeFixture(baseDir, relPath, content) {
    const fullPath = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    return fullPath;
}

function runWith(env) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enforce-shas-out-'));
    const tmpOut = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(tmpOut, '');
    const r = withEnv({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
    r.outputContent = fs.readFileSync(tmpOut, 'utf8');
    const violationsLine = r.outputContent.split('\n').find(l => l.startsWith('violations='));
    r.violations = violationsLine ? JSON.parse(violationsLine.slice('violations='.length)) : null;
    return r;
}

test('all pinned actions produce zero violations', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'clean.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        `      - uses: actions/checkout@${PINNED_SHA} # v6`,
        '      - uses: ./local-action',
        '      - uses: ../sibling-action',
        '      - uses: docker://alpine@sha256:abc123',
        '      - run: echo "no uses here"',
    ].join('\n'));
    const r = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.violations.length, 0);
    assert.match(r.out, /Exiting successfully/);
});

test('unpinned tag refs are reported as violations and exit 1', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'violations.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - uses: actions/setup-node@main',
        `      - uses: actions/cache@${PINNED_SHA}`,
    ].join('\n'));
    const r = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.violations.length, 2);
    assert.match(r.err, /actions\/checkout@v4/);
    assert.match(r.err, /actions\/setup-node@main/);
    assert.match(r.err, /Exiting because one or more uses:/);
});

test('missing ref (no @) is reported with a distinct reason', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'no-ref.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout',
    ].join('\n'));
    const r = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.violations.length, 1);
    assert.match(r.violations[0].reason, /missing a pinned ref/);
});

test('exclude-action-pattern excludes matching actions from the SHA check', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'mixed.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: Now-Micro/actions/setup-node@v1',
        '      - uses: trafera-llc/some-action@main',
        '      - uses: actions/checkout@v4',
    ].join('\n'));
    const withPattern = runWith({ INPUT_SCAN_PATHS: dir, INPUT_EXCLUDE_ACTION_PATTERN: '^(Now-Micro|trafera-llc)/' });
    assert.strictEqual(withPattern.exitCode, 1);
    assert.strictEqual(withPattern.violations.length, 1);
    assert.match(withPattern.violations[0].uses, /actions\/checkout@v4/);

    const withoutPattern = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(withoutPattern.exitCode, 1);
    assert.strictEqual(withoutPattern.violations.length, 3);
});

test('exclude-dirs skips scanning specified directories', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'keep/good.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        `      - uses: actions/checkout@${PINNED_SHA}`,
    ].join('\n'));
    writeFixture(dir, 'skip/bad.yml', [
        'jobs:',
        '  build:',
        '    steps:',
        '      - uses: actions/checkout@v4',
    ].join('\n'));

    const excluded = runWith({ INPUT_SCAN_PATHS: dir, INPUT_EXCLUDE_DIRS: 'skip', INPUT_DEBUG_MODE: 'true' });
    assert.strictEqual(excluded.exitCode, 0);
    assert.strictEqual(excluded.violations.length, 0);
    assert.match(excluded.out, /Excluding '/);

    const included = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(included.exitCode, 1);
    assert.strictEqual(included.violations.length, 1);
});

test('invalid exclude-action-pattern regex exits 1', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'sample.yml', `      - uses: actions/checkout@${PINNED_SHA}\n`);
    const r = runWith({ INPUT_SCAN_PATHS: dir, INPUT_EXCLUDE_ACTION_PATTERN: '(unclosed' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not a valid regex/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'sample.yml', `      - uses: actions/checkout@${PINNED_SHA}\n`);
    const r = withEnv({ INPUT_SCAN_PATHS: dir, GITHUB_OUTPUT: '' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_OUTPUT is not set/);
});

test('nonexistent scan path is skipped without crashing', () => {
    const missing = path.join(os.tmpdir(), 'enforce-shas-does-not-exist-' + Date.now());
    const r = runWith({ INPUT_SCAN_PATHS: missing, INPUT_DEBUG_MODE: 'true' });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.violations.length, 0);
    assert.match(r.out, /does not exist, skipping/);
});

test('blank entries in scan-paths resolve to no paths and exit 1', () => {
    const r = runWith({ INPUT_SCAN_PATHS: ' , ,', INPUT_DEBUG_MODE: 'true' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /resolved to no paths to scan/);
    assert.match(r.out, /INPUT_SCAN_PATHS: \(none\)/);
});

test('INPUT_SCAN_PATHS unset falls back to the default .github/workflows directory', () => {
    const tmpDir = makeTempDir();
    writeFixture(tmpDir, '.github/workflows/default.yml', `      - uses: actions/checkout@${PINNED_SHA}\n`);
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
        const env = { ...process.env };
        delete env.INPUT_SCAN_PATHS;
        const r = runWith(env);
        assert.strictEqual(r.exitCode, 0);
        assert.strictEqual(r.violations.length, 0);
    } finally {
        process.chdir(prevCwd);
    }
});

test('scan-paths pointing directly to a single yaml file is scanned', () => {
    const dir = makeTempDir();
    const file = writeFixture(dir, 'single.yml', '      - uses: actions/checkout@v4\n');
    const r = runWith({ INPUT_SCAN_PATHS: file });
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.violations.length, 1);
});

test('scan-paths pointing directly to a non-yaml file scans nothing', () => {
    const dir = makeTempDir();
    const file = writeFixture(dir, 'notes.txt', 'uses: actions/checkout@v4\n');
    const r = runWith({ INPUT_SCAN_PATHS: file });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.violations.length, 0);
});

test('debug mode logs configuration and per-line details', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'sample.yml', [
        `      - uses: actions/checkout@${PINNED_SHA}`,
        '      - uses: Now-Micro/actions/setup-node@v1',
        '      - uses: ./local-action',
    ].join('\n'));
    const r = runWith({
        INPUT_SCAN_PATHS: dir,
        INPUT_EXCLUDE_ACTION_PATTERN: '^Now-Micro/',
        INPUT_DEBUG_MODE: 'true',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug mode is ON/);
    assert.match(r.out, /matches exclude-action-pattern/);
    assert.match(r.out, /Skipping local\/docker reference/);
});

test('non-yaml files in scanned directories are ignored', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'ignored.txt', 'uses: actions/checkout@v4\n');
    writeFixture(dir, 'sample.yaml', `      - uses: actions/checkout@${PINNED_SHA}\n`);
    const r = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.violations.length, 0);
});

test('quoted uses values and trailing comments are parsed correctly', () => {
    const dir = makeTempDir();
    writeFixture(dir, 'quoted.yml', [
        `      - uses: 'actions/checkout@${PINNED_SHA}' # v6`,
        '      - uses: "actions/setup-node@v4" # comment',
    ].join('\n'));
    const r = runWith({ INPUT_SCAN_PATHS: dir });
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.violations.length, 1);
    assert.match(r.violations[0].uses, /actions\/setup-node@v4/);
});

test('multiple comma-separated scan-paths are all scanned', () => {
    const dirA = makeTempDir();
    const dirB = makeTempDir();
    writeFixture(dirA, 'a.yml', '      - uses: actions/checkout@v4\n');
    writeFixture(dirB, 'b.yml', '      - uses: actions/setup-node@main\n');
    const r = runWith({ INPUT_SCAN_PATHS: `${dirA},${dirB}` });
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.violations.length, 2);
});

// --- direct unit tests for exported helpers (covers edge branches) ---

test('collectYamlFiles logs and returns empty for an unreadable root (ENOTDIR)', () => {
    const dir = makeTempDir();
    const file = writeFixture(dir, 'not-a-dir.yml', 'content');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    let files;
    try {
        files = collectYamlFiles(file, [], true);
    } finally {
        console.log = origLog;
    }
    assert.deepStrictEqual(files, []);
    assert.ok(logs.some(l => l.includes('Skipping unreadable path')));
});

test('checkFile returns empty array when the file has no uses: lines', () => {
    const dir = makeTempDir();
    const file = writeFixture(dir, 'plain.yml', 'jobs:\n  build:\n    steps:\n      - run: echo hi\n');
    const violations = checkFile(file, null, false);
    assert.deepStrictEqual(violations, []);
});

test('isExcludedPath matches exact path, prefix, and path segment', () => {
    assert.strictEqual(isExcludedPath('skip', ['skip']), true);
    assert.strictEqual(isExcludedPath('skip/nested/file.yml', ['skip']), true);
    assert.strictEqual(isExcludedPath('a/skip/file.yml', ['skip']), true);
    assert.strictEqual(isExcludedPath('keep/file.yml', ['skip']), false);
    assert.strictEqual(isExcludedPath('anything', []), false);
    assert.strictEqual(isExcludedPath('anything', ['./', '']), false);
});

test('parseBool handles booleans, truthy/falsy strings, and defaults', () => {
    assert.strictEqual(parseBool(undefined, true), true);
    assert.strictEqual(parseBool('', false), false);
    assert.strictEqual(parseBool(true, false), true);
    assert.strictEqual(parseBool('true', false), true);
    assert.strictEqual(parseBool('0', true), false);
    assert.strictEqual(parseBool('maybe', true), true);
});

test('parseList trims, strips brackets/quotes, and filters blanks', () => {
    assert.deepStrictEqual(parseList('a, b ,"c", [d]'), ['a', 'b', 'c', 'd']);
    assert.deepStrictEqual(parseList(''), []);
    assert.deepStrictEqual(parseList(undefined), []);
});
