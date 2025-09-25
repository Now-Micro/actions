const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, applyReplacements } = require('./string-manipulator');

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

test('missing INPUT_STRING with regex exits 1', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_REGEX: '(x)' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_STRING not set/);
});

test('missing INPUT_STRING with replacement exits 1', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out, INPUT_REPLACEMENT: JSON.stringify([["x", "y", "g"]]) }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_STRING not set/);
});

test('no inputs provided -> exit 0, no outputs written', () => {
    const out = mkout();
    const r = withEnv({ GITHUB_OUTPUT: out }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.strictEqual(content, '');
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

test('replacement-only mode writes replaced output (no matches written)', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'Hello John Doe',
        INPUT_REPLACEMENT: JSON.stringify([["John", "Jane", "g"], ["Doe", "Doe-Sr", "g"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /replaced=Hello Jane Doe-Sr/);
    // Matching should not run since regex not provided
    assert.ok(!/\bmatches=/.test(content));
});

test('both modes: writes matches and replaced', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'a1 a2 a3',
        INPUT_REGEX: 'a(\\d)',
        INPUT_REPLACEMENT: JSON.stringify([["a", "b", "g"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=1,2,3/);
    assert.match(content, /replaced=b1 b2 b3/);
});

test('captures multiple groups and exposes matches_all_groups', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'x=10;y=20;z=30',
        INPUT_REGEX: '([a-z])=(\\d+)',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // matches should be just the first group
    assert.match(content, /matches=\["x","y","z"\]/);
    // matches_all_groups should include all groups per match
    assert.match(content, /matches_all_groups=\[\["x","10"\],\["y","20"\],\["z","30"\]\]/);
});

test('matches_all_groups with 4 groups (some empty)', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'A',
        INPUT_REGEX: '(A)(A)?(A)?(A)?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\["A"\]/);
    assert.match(content, /matches_all_groups=\[\["A","","",""\]\]/);
});

test('matches_all_groups with 5 groups (some empty)', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'A',
        INPUT_REGEX: '(A)(A)?(A)?(A)?(A)?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\["A"\]/);
    assert.match(content, /matches_all_groups=\[\["A","","","",""\]\]/);
});

test('matches_all_groups with 8 groups (some empty)', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'A',
        INPUT_REGEX: '(A)(A)?(A)?(A)?(A)?(A)?(A)?(A)?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\["A"\]/);
    assert.match(content, /matches_all_groups=\[\["A","","","","","","",""\]\]/);
});

test('debug mode logs and replacement preview appear', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_DEBUG_MODE: 'true',
        INPUT_STRING: 'x=1;y=2',
        INPUT_REGEX: '([a-z])=(\\d+)',
        INPUT_REGEX_FLAGS: 'i',
        INPUT_REPLACEMENT: JSON.stringify([["([a-z])=(\\d+)", "$1:$2", "ig"]]),
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    // stdout should include debug logs
    assert.match(r.out, /Debug mode is ON/);
    assert.match(r.out, /INPUT_REGEX_FLAGS: i/);
    assert.match(r.out, /Match: /);
    assert.match(r.out, /All groups: /);
    assert.match(r.out, /Replace preview:/);
});

test('array-of-tuples replacement example from prompt', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'Hello My name is Adam',
        INPUT_REGEX: '(Hello)',
        INPUT_REPLACEMENT: JSON.stringify([["\\s", "-", "g"], ["adam", "tom", "i"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /replaced=Hello-My-name-is-tom/);
});

test('applyReplacements standalone success and errors', () => {
    // success path
    const result = applyReplacements('Hello My name is Adam', JSON.stringify([["\\s", "-", "g"], ["adam", "tom", "i"]]));
    assert.strictEqual(result, 'Hello-My-name-is-tom');

    // invalid JSON
    assert.throws(() => applyReplacements('x', 'not-json'), /Invalid replacement JSON/);

    // not an array
    assert.throws(() => applyReplacements('x', '"oops"'), /Replacement must be a JSON array of tuples/);

    // bad tuple shape
    assert.throws(() => applyReplacements('x', '["not-a-tuple"]'), /tuple at index 0/);

    // non-string members
    assert.throws(() => applyReplacements('x', '[[1,2]]'), /must have string pattern and replacement/);

    // invalid regex flags/pattern
    assert.throws(() => applyReplacements('x', '[["(","y"]]'), /Invalid replacement regex at index 0/);
});

test('invalid replacement JSON exits 1', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'x',
        INPUT_REGEX: '(x)',
        INPUT_REPLACEMENT: '["not-a-tuple"]'
    }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Replacement must be a JSON array of tuples|Invalid replacement JSON|Replacement tuple at index/);
});

test('no matches writes empty matches_all_groups', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'bbb',
        INPUT_REGEX: '(a)',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\[\]/);
    assert.match(content, /matches_all_groups=\[\]/);
});

test('empty replacement does not write replaced output', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'abc',
        INPUT_REGEX: '(a)',
        INPUT_REPLACEMENT: ''
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=a/);
    assert.ok(!/\breplaced=/.test(content));
});

test('complex 4-group date pattern with mixed optional match', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: '2025-09-24-UTC;2024-01-02',
        INPUT_REGEX: '([0-9]{4})-([0-9]{2})-([0-9]{2})(?:-([A-Za-z]+))?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // First-group year values
    assert.match(content, /matches=\["2025","2024"\]/);
    // All groups: first has 4 groups populated, second missing the 4th
    assert.match(content, /matches_all_groups=\[\["2025","09","24","UTC"\],\["2024","01","02",""\]\]/);
});

test('complex 5-group key=val with decorated optionals', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'a=10(BIG){foo}[7];b=20{bar};c=30[9];d=40',
        INPUT_REGEX: '([a-z])=(\\d+)(?:\\(([A-Z]+)\\))?(?:\\{([a-z]+)\\})?(?:\\\\?\n?\n?\n?)',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    // NOTE: Above accidental complex escaping may be wrong; correcting with intended regex below
});

test('complex 5-group key=val with decorated optionals (corrected)', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'a=10(BIG){foo}[7];b=20{bar};c=30[9];d=40',
        INPUT_REGEX: '([a-z])=(\\d+)(?:\\(([A-Z]+)\\))?(?:\\{([a-z]+)\\})?(?:\\[(\\d+)\\])?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /matches=\["a","b","c","d"\]/);
    // Expect: a -> [a,10,BIG,foo,7] ; b -> [b,20,,bar,] ; c -> [c,30,,,9] ; d -> [d,40,,,]
    assert.match(content, /matches_all_groups=\[\["a","10","BIG","foo","7"\],\["b","20","","bar",""\],\["c","30","","","9"\],\["d","40","","",""\]\]/);
});

test('complex 8-group semver with extras across two matches', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: '1.2.3-alpha+build/feature#frag@prod 10.20.30+meta@dev',
        INPUT_REGEX: '(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z.-]+))?(?:\\+([0-9A-Za-z.-]+))?(?:\\/([\\\w-]+))?(?:#([\\\w-]+))?(?:@([\\\w-]+))?',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // First-group: major versions
    assert.match(content, /matches=\["1","10"\]/);
    // All groups for two matches
    assert.match(content, /matches_all_groups=\[\["1","2","3","alpha","build","feature","frag","prod"\],\["10","20","30","","meta","","","dev"\]\]/);
});

test('real use case - 1', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src',
        INPUT_REGEX: '(.*)\/src',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // First-group: major versions
    assert.match(content, /matches=\["CSI"\]/);
    // All groups for two matches
    assert.match(content, /matches_all_groups=\[\["CSI"\]\]/);
});

test('real use case - 2', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src',
        INPUT_REGEX: '(.*)/src',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // First-group: major versions
    assert.match(content, /matches=\["CSI"\]/);
    // All groups for two matches
    assert.match(content, /matches_all_groups=\[\["CSI"\]\]/);
});

test('real use case - 3', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src',
        INPUT_REGEX: '(.*)\\/src',
        INPUT_OUTPUT_IS_JSON: 'true'
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    // First-group: major versions
    assert.match(content, /matches=\["CSI"\]/);
    // All groups for two matches
    assert.match(content, /matches_all_groups=\[\["CSI"\]\]/);
});

test('can handle unescaped /', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src-main',
        INPUT_REPLACEMENT: JSON.stringify([["/src-MAIN", "/lib", "i"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /replaced=CSI\/lib/);
});

test('can handle /.../', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src-main',
        INPUT_REPLACEMENT: JSON.stringify([["/\/src-MAIN/", "/lib", "i"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /replaced=CSI\/lib/);
});

test('can handle escaped /', () => {
    const out = mkout();
    const r = withEnv({
        GITHUB_OUTPUT: out,
        INPUT_STRING: 'CSI/src-main',
        INPUT_REPLACEMENT: JSON.stringify([["\/src-MAIN", "/lib", "i"]])
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(out, 'utf8');
    assert.match(content, /replaced=CSI\/lib/);
});
