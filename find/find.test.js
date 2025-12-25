const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('./find');

function parseOutputs(outputContent) {
    const filesMatch = outputContent.match(/matched-files=(.*)/);
    const relMatch = outputContent.match(/matched-dirs-relative=(.*)/);
    const absMatch = outputContent.match(/matched-dirs-absolute=(.*)/);
    return {
        files: filesMatch ? JSON.parse(filesMatch[1]) : [],
        rel: relMatch ? JSON.parse(relMatch[1]) : [],
        abs: absMatch ? JSON.parse(absMatch[1]) : [],
    };
}

function makeTempDir(prefix = 'find-action-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWithEnv(env) {
    const tmpOut = path.join(makeTempDir('find-out-'), 'out.txt');
    fs.writeFileSync(tmpOut, '');
    const prev = { ...process.env };
    Object.keys(process.env).filter(k => k.startsWith('INPUT_')).forEach(k => delete process.env[k]);
    Object.assign(process.env, env, { GITHUB_OUTPUT: tmpOut });

    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return origOut.call(process.stdout, c, e, cb); };
    process.stderr.write = (c, e, cb) => { err += c; return origErr.call(process.stderr, c, e, cb); };

    try {
        try { run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = origOut;
        process.stderr.write = origErr;
    }

    const outputContent = fs.readFileSync(tmpOut, 'utf8');
    return { exitCode, out, err, outputContent };
}

test('matches literal filename and returns relative dirs', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'target.txt'), 'hi');
    fs.writeFileSync(path.join(dir, 'target.txt.bak'), 'nope');

    const r = runWithEnv({ INPUT_REGEX: 'target.txt', INPUT_WORKING_DIRECTORY: dir });
    assert.strictEqual(r.exitCode, 0);
    const { files, rel, abs } = parseOutputs(r.outputContent);
    assert.deepStrictEqual(files, ['target.txt']);
    assert.deepStrictEqual(rel, ['./']);
    const expectedAbs = dir.split(path.sep).join('/');
    assert.deepStrictEqual(abs, [expectedAbs]);
});

test('regex matches multiple files across directories in order', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'root.log'), 'root');
    const subA = path.join(dir, 'a');
    const subB = path.join(dir, 'b');
    const subA1 = path.join(subA, 'sub');
    fs.mkdirSync(subA1, { recursive: true });
    fs.mkdirSync(subB, { recursive: true });
    fs.writeFileSync(path.join(subA, 'one.log'), '1');
    fs.writeFileSync(path.join(subA1, 'two.log'), '2');
    fs.writeFileSync(path.join(subB, 'three.txt'), '3');

    const r = runWithEnv({ INPUT_REGEX: '\\.(log)$', INPUT_WORKING_DIRECTORY: dir });
    assert.strictEqual(r.exitCode, 0);
    const { files, rel } = parseOutputs(r.outputContent);
    assert.deepStrictEqual(files, ['root.log', 'a/one.log', 'a/sub/two.log']);
    assert.deepStrictEqual(rel, ['./', './a', './a/sub']);
});

test('working-directory restricts search scope', () => {
    const dir = makeTempDir();
    const inner = path.join(dir, 'inner');
    const outerFile = path.join(dir, 'outer.log');
    fs.mkdirSync(inner);
    fs.writeFileSync(outerFile, 'outer');
    fs.writeFileSync(path.join(inner, 'inner.log'), 'inner');

    const r = runWithEnv({ INPUT_REGEX: '.*log$', INPUT_WORKING_DIRECTORY: inner });
    assert.strictEqual(r.exitCode, 0);
    const { files } = parseOutputs(r.outputContent);
    assert.deepStrictEqual(files, ['inner.log']);
    assert.ok(!r.outputContent.includes('outer.log'));
});

test('absolute directories are emitted and align with relative', () => {
    const dir = makeTempDir();
    const sub = path.join(dir, 'sub');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'note.md'), 'note');

    const r = runWithEnv({ INPUT_REGEX: 'note.md', INPUT_WORKING_DIRECTORY: dir });
    assert.strictEqual(r.exitCode, 0);
    const { files, rel, abs } = parseOutputs(r.outputContent);
    const expectedAbs = path.join(sub).split(path.sep).join('/');
    assert.deepStrictEqual(files, ['sub/note.md']);
    assert.deepStrictEqual(rel, ['./sub']);
    assert.deepStrictEqual(abs, [expectedAbs]);
});

test('no matches writes empty arrays', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'unmatched.txt'), 'noop');
    const r = runWithEnv({ INPUT_REGEX: '\\.(log)$', INPUT_WORKING_DIRECTORY: dir });
    assert.strictEqual(r.exitCode, 0);
    const { files, rel, abs } = parseOutputs(r.outputContent);
    assert.deepStrictEqual(files, []);
    assert.deepStrictEqual(rel, []);
    assert.deepStrictEqual(abs, []);
});

test('debug mode logs matched arrays', () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, 'hit.log'), 'hit');
    const r = runWithEnv({ INPUT_REGEX: 'hit.log', INPUT_WORKING_DIRECTORY: dir, INPUT_DEBUG_MODE: 'true' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug: matched files =/);
    assert.match(r.out, /Debug: matched dirs \(relative\) =/);
    assert.match(r.out, /Debug: matched dirs \(absolute\) =/);
});

test('invalid regex exits 1', () => {
    const r = runWithEnv({ INPUT_REGEX: '[unclosed', INPUT_WORKING_DIRECTORY: makeTempDir() });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid regex/);
});

test('missing regex exits 1', () => {
    const r = runWithEnv({ INPUT_WORKING_DIRECTORY: makeTempDir() });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_REGEX is required/);
});

test('nonexistent working directory exits 1', () => {
    const missing = path.join(os.tmpdir(), `missing-${Date.now()}`);
    const r = runWithEnv({ INPUT_REGEX: '.*', INPUT_WORKING_DIRECTORY: missing });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Working directory does not exist/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const dir = makeTempDir();
    const prev = { ...process.env };
    Object.assign(process.env, { INPUT_REGEX: '.*', INPUT_WORKING_DIRECTORY: dir });
    delete process.env.GITHUB_OUTPUT;
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return true; };
    process.stderr.write = (c, e, cb) => { err += c; return true; };
    try {
        try { run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }
    assert.strictEqual(exitCode, 1);
    assert.match(err + out, /GITHUB_OUTPUT not set/);
});
