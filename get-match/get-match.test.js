const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./get-match');

function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    let exitCode = 0; const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
    process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
    try { try { fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; } } finally {
        process.env = prev; process.exit = origExit; process.stdout.write = so; process.stderr.write = se;
    }
    return { exitCode, out, err };
}

function mkout() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gma-'));
    const out = path.join(tmp, 'out.txt');
    fs.writeFileSync(out, '');
    return out;
}

test('extracts words using group1 (default CSV)', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'one two three', INPUT_REGEX: '(\\w+)', INPUT_REGEX_FLAGS: 'g' }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=one,two,three/);
});

test('numbers from text (case-insensitive flag optional, default CSV)', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'A1 b22 C333', INPUT_REGEX: '([0-9]+)', INPUT_REGEX_FLAGS: '' }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=1,22,333/);
});

test('no matches writes empty CSV', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'abc', INPUT_REGEX: '(\\d+)' }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=/); // empty string
});

test('invalid regex exits 1', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'abc', INPUT_REGEX: '([unclosed' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Invalid regex/);
});

test('missing regex exits 1', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'abc' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_REGEX is required/);
});

test('missing capturing group exits 1', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'abc', INPUT_REGEX: 'abc' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /capturing group/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const r = withEnv({ GITHUB_OUTPUT: '', INPUT_STRING: 'x', INPUT_REGEX: '(x)' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_OUTPUT not set/);
});

test('output-is-json=false outputs CSV', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'x y z', INPUT_REGEX: '(\\w+)', INPUT_OUTPUT_IS_JSON: 'false' }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=x,y,z/);
});

test('output-is-json=true outputs JSON', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_STRING: 'x y z', INPUT_REGEX: '(\\w+)', INPUT_OUTPUT_IS_JSON: 'true' }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\["x","y","z"\]/);
});
