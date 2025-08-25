const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runWith(env) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    const so = process.stdout.write, se = process.stderr.write;
    let out = '', err = '';
    process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
    process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
    let code = 0; const oe = process.exit; process.exit = c => { code = c || 0; throw new Error(`__EXIT_${code}__`); };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-')); const outFile = path.join(tmp, 'out.txt'); fs.writeFileSync(outFile, '');
    process.env.GITHUB_OUTPUT = outFile;
    try {
        try {
            // Clear require cache so the module runs fresh each time
            delete require.cache[require.resolve('./validate-and-export')];
            require('./validate-and-export');
        } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev; process.stdout.write = so; process.stderr.write = se; process.exit = oe;
    }
    const outputs = fs.readFileSync(outFile, 'utf8');
    return { out, err, code, outputs };
}

test('missing names', () => {
    const r = runWith({ INPUT_USERNAMES: 'u', INPUT_PASSWORDS: 'p', INPUT_URLS: 'x' });
    assert.match(r.outputs, /names=/);
    assert.match(r.outputs, /usernames=/);
    assert.match(r.outputs, /passwords=/);
    assert.match(r.outputs, /urls=/);
});

test('missing usernames', () => {
    const r = runWith({ INPUT_NAMES: 'n', INPUT_PASSWORDS: 'p', INPUT_URLS: 'x' });
    assert.match(r.outputs, /names=/);
    assert.match(r.outputs, /usernames=/);
    assert.match(r.outputs, /passwords=/);
    assert.match(r.outputs, /urls=/);
});

test('missing passwords', () => {
    const r = runWith({ INPUT_NAMES: 'n', INPUT_USERNAMES: 'u', INPUT_URLS: 'x' });
    assert.match(r.outputs, /names=/);
    assert.match(r.outputs, /usernames=/);
    assert.match(r.outputs, /passwords=/);
    assert.match(r.outputs, /urls=/);
});

test('missing urls', () => {
    const r = runWith({ INPUT_NAMES: 'n', INPUT_USERNAMES: 'u', INPUT_PASSWORDS: 'p' });
    assert.match(r.outputs, /names=/);
    assert.match(r.outputs, /usernames=/);
    assert.match(r.outputs, /passwords=/);
    assert.match(r.outputs, /urls=/);
});

test('missing multiple', () => {
    const r = runWith({ INPUT_NAMES: 'n', INPUT_PASSWORDS: 'p' });
    assert.match(r.outputs, /names=/);
    assert.match(r.outputs, /usernames=/);
    assert.match(r.outputs, /passwords=/);
    assert.match(r.outputs, /urls=/);
});

test('mismatched counts - 1', () => {
    const r = runWith({ INPUT_NAMES: 'a,b', INPUT_USERNAMES: 'u1,u2,u3', INPUT_PASSWORDS: 'p1,p2', INPUT_URLS: 'x1,x2' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 2 source/);
    assert.match(r.outputs, /names=a,b/);
    assert.match(r.outputs, /usernames=u1,u2/);
    assert.match(r.outputs, /passwords=p1,p2/);
    assert.match(r.outputs, /urls=x1,x2/);
});

test('mismatched counts - 2', () => {
    const r = runWith({ INPUT_NAMES: ',b', INPUT_USERNAMES: 'u1,u2,u3', INPUT_PASSWORDS: 'p1,p2', INPUT_URLS: 'x1,x2' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 1 source/);
    assert.match(r.outputs, /names=b/);
    assert.match(r.outputs, /usernames=u2/);
    assert.match(r.outputs, /passwords=p2/);
    assert.match(r.outputs, /urls=x2/);
});

test('mismatched counts - 3', () => {
    const r = runWith({ INPUT_NAMES: ',b,c', INPUT_USERNAMES: 'u1,u2,u3', INPUT_PASSWORDS: 'p1,p2', INPUT_URLS: 'x1,x2' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 1 source/);
    assert.match(r.outputs, /names=b/);
    assert.match(r.outputs, /usernames=u2/);
    assert.match(r.outputs, /passwords=p2/);
    assert.match(r.outputs, /urls=x2/);
});

test('mismatched counts - 4', () => {
    const r = runWith({ INPUT_NAMES: 'b,c,d', INPUT_USERNAMES: 'u1,u2,u3', INPUT_PASSWORDS: 'p1,p2', INPUT_URLS: 'x1,x2' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 2 source/);
    assert.match(r.outputs, /names=b,c/);
    assert.match(r.outputs, /usernames=u1,u2/);
    assert.match(r.outputs, /passwords=p1,p2/);
    assert.match(r.outputs, /urls=x1,x2/);
});

test('mismatched counts - 5', () => {
    const r = runWith({ INPUT_NAMES: 'b,c,d,,,', INPUT_USERNAMES: 'u1,u2,u3', INPUT_PASSWORDS: 'p1,p2', INPUT_URLS: 'x1,x2' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 2 source/);
    assert.match(r.outputs, /names=b,c/);
    assert.match(r.outputs, /usernames=u1,u2/);
    assert.match(r.outputs, /passwords=p1,p2/);
    assert.match(r.outputs, /urls=x1,x2/);
});

test('mismatched counts - 6', () => {
    const r = runWith({ INPUT_NAMES: 'b,c,d,,,', INPUT_USERNAMES: 'u1,u2,u3,,', INPUT_PASSWORDS: 'p1,p2,,', INPUT_URLS: 'x1,x2,,,,,' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 2 source/);
    assert.match(r.outputs, /names=b,c/);
    assert.match(r.outputs, /usernames=u1,u2/);
    assert.match(r.outputs, /passwords=p1,p2/);
    assert.match(r.outputs, /urls=x1,x2/);
});

test('valid single', () => {
    const r = runWith({ INPUT_NAMES: 'A', INPUT_USERNAMES: 'u', INPUT_PASSWORDS: 'p', INPUT_URLS: 'x' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 1 source/);
    assert.match(r.outputs, /count=1/);
    assert.match(r.outputs, /names=A/);
    assert.match(r.outputs, /usernames=u/);
    assert.match(r.outputs, /passwords=p/);
    assert.match(r.outputs, /urls=x/);
});

test('valid multi with spaces and empty items filtered', () => {
    const r = runWith({ INPUT_NAMES: ' A , ,B ', INPUT_USERNAMES: ' u1 , u2 ', INPUT_PASSWORDS: ' p1 , p2 ', INPUT_URLS: ' x1 , x2 ' });
    assert.strictEqual(r.code, 0);
    assert.match(r.out, /Validated 2 source/);
    assert.match(r.outputs, /names=A,B/);
    assert.match(r.outputs, /usernames=u1,u2/);
    assert.match(r.outputs, /passwords=p1,p2/);
    assert.match(r.outputs, /urls=x1,x2/);
});