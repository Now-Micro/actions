const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('./compare-json-arrays');

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

function runWith(env) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cja-'));
    const tmpOut = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(tmpOut, '');
    const r = withEnv({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
    r.outputFile = tmpOut;
    r.outputContent = fs.readFileSync(tmpOut, 'utf8');
    return r;
}

function getResult(r) {
    const m = r.outputContent.match(/^result=(.+)$/m);
    return m ? JSON.parse(m[1]) : null;
}

// ── intersection ──────────────────────────────────────────────────────────────

test('intersection: returns common items', () => {
    const r = runWith({
        INPUT_MODE: 'intersection',
        INPUT_ARRAY_A: '["a","b","c"]',
        INPUT_ARRAY_B: '["b","c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['b', 'c']);
});

test('intersection: no common items returns empty array', () => {
    const r = runWith({
        INPUT_MODE: 'intersection',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('intersection: identical arrays returns all items', () => {
    const r = runWith({
        INPUT_MODE: 'intersection',
        INPUT_ARRAY_A: '["x","y"]',
        INPUT_ARRAY_B: '["x","y"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['x', 'y']);
});

test('intersection: empty array-a returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'intersection',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('intersection: empty array-b returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'intersection',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '[]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

// ── union ─────────────────────────────────────────────────────────────────────

test('union: merges and deduplicates items', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["b","c"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b', 'c']);
});

test('union: no overlap returns all items in order', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b', 'c', 'd']);
});

test('union: identical arrays deduplicates to same items', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["x","y"]',
        INPUT_ARRAY_B: '["x","y"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['x', 'y']);
});

test('union: empty array-a returns array-b', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

test('union: both empty returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '[]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

// ── diff ──────────────────────────────────────────────────────────────────────

test('left-diff: returns items in A not in B', () => {
    const r = runWith({
        INPUT_MODE: 'left-diff',
        INPUT_ARRAY_A: '["a","b","c"]',
        INPUT_ARRAY_B: '["b","c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a']);
});

test('left-diff: no overlap returns all of A', () => {
    const r = runWith({
        INPUT_MODE: 'left-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

test('left-diff: identical arrays returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'left-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('left-diff: empty array-a returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'left-diff',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('left-diff: empty array-b returns all of A', () => {
    const r = runWith({
        INPUT_MODE: 'left-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '[]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

// ── right-diff ──────────────────────────────────────────────────────────────

test('right-diff: returns items in B not in A', () => {
    const r = runWith({
        INPUT_MODE: 'right-diff',
        INPUT_ARRAY_A: '["a","b","c"]',
        INPUT_ARRAY_B: '["b","c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['d']);
});

test('right-diff: no overlap returns all of B', () => {
    const r = runWith({
        INPUT_MODE: 'right-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['c', 'd']);
});

test('right-diff: identical arrays returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'right-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('right-diff: empty array-b returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'right-diff',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '[]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('right-diff: empty array-a returns all of B', () => {
    const r = runWith({
        INPUT_MODE: 'right-diff',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

// ── unique ────────────────────────────────────────────────────────────────────

test('unique: returns items in exactly one array', () => {
    const r = runWith({
        INPUT_MODE: 'unique',
        INPUT_ARRAY_A: '["a","b","c"]',
        INPUT_ARRAY_B: '["b","c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'd']);
});

test('unique: no overlap returns all items from both', () => {
    const r = runWith({
        INPUT_MODE: 'unique',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["c","d"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b', 'c', 'd']);
});

test('unique: identical arrays returns empty', () => {
    const r = runWith({
        INPUT_MODE: 'unique',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), []);
});

test('unique: empty array-a returns all of B', () => {
    const r = runWith({
        INPUT_MODE: 'unique',
        INPUT_ARRAY_A: '[]',
        INPUT_ARRAY_B: '["a","b"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

test('unique: empty array-b returns all of A', () => {
    const r = runWith({
        INPUT_MODE: 'unique',
        INPUT_ARRAY_A: '["a","b"]',
        INPUT_ARRAY_B: '[]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(getResult(r), ['a', 'b']);
});

// ── error cases ─────────────────────────────────────────────────────────────────

test('invalid mode exits 1', () => {
    const r = runWith({
        INPUT_MODE: 'bogus',
        INPUT_ARRAY_A: '["a"]',
        INPUT_ARRAY_B: '["b"]',
    });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_MODE must be one of/);
});

test('missing mode exits 1', () => {
    const r = runWith({
        INPUT_ARRAY_A: '["a"]',
        INPUT_ARRAY_B: '["b"]',
    });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_MODE must be one of/);
});

test('invalid JSON in array-a exits 1', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: 'not-json',
        INPUT_ARRAY_B: '["b"]',
    });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Failed to parse INPUT_ARRAY_A/);
});

test('invalid JSON in array-b exits 1', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["a"]',
        INPUT_ARRAY_B: '{not: array}',
    });
    assert.strictEqual(r.exitCode, 1);
});

test('non-array JSON in array-a exits 1', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '"just-a-string"',
        INPUT_ARRAY_B: '["b"]',
    });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /must be a JSON array/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const r = withEnv({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["a"]',
        INPUT_ARRAY_B: '["b"]',
        GITHUB_OUTPUT: '',
    }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_OUTPUT not set/);
});

// ── output format ─────────────────────────────────────────────────────────────

test('result is written as valid JSON array to GITHUB_OUTPUT', () => {
    const r = runWith({
        INPUT_MODE: 'union',
        INPUT_ARRAY_A: '["foo","bar"]',
        INPUT_ARRAY_B: '["baz"]',
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /^result=\[/m);
    const result = getResult(r);
    assert.ok(Array.isArray(result));
    assert.deepStrictEqual(result, ['foo', 'bar', 'baz']);
});
