const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const { run, isSemVer, toBaseSemVer } = require('./generate-version');

async function withEnvAsync(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return true; };
    process.stderr.write = (c, e, cb) => { err += c; return true; };
    try {
        try { await fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }
    return { exitCode, out, err };
}

async function runWith(env, githubRepo = 'owner/repo') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-'));
    const outFile = path.join(dir, 'out.txt');
    fs.writeFileSync(outFile, '');
    const r = await withEnvAsync({ ...env, GITHUB_OUTPUT: outFile, GITHUB_REPOSITORY: githubRepo }, () => run());
    r.outputFile = outFile;
    r.outputContent = fs.readFileSync(outFile, 'utf8');
    return r;
}

function mockHttpsOnce(statusCode, body) {
    const orig = https.request;
    https.request = (opts, cb) => {
        const events = {};
        const res = { statusCode, on: (ev, fn) => { events[ev] = fn; }, headers: {} };
        process.nextTick(() => {
            cb(res);
            if (events['data']) events['data'](typeof body === 'string' ? body : JSON.stringify(body))
            if (events['end']) events['end']();
        });
        return { on: () => { }, end: () => { }, write: () => { } };
    };
    return () => { https.request = orig; };
}

// Helpers for deterministic timestamp
function mockDate(iso) {
    const RealDate = Date;
    // month is 0-based in JS Date
    const d = new Date(iso);
    global.Date = class extends RealDate {
        constructor(...args) {
            if (args.length) return new RealDate(...args);
            return d;
        }
        static now() { return d.getTime(); }
        static UTC(...args) { return RealDate.UTC(...args); }
        static parse(s) { return RealDate.parse(s); }
    };
    return () => { global.Date = RealDate; };
}

// Unit tests

test('isSemVer true/false', () => {
    assert.strictEqual(isSemVer('1.2.3'), true);
    assert.strictEqual(isSemVer('1.2.3-alpha.1'), true);
    assert.strictEqual(isSemVer('1.2'), false);
});

test('toBaseSemVer trims, reduces, strips prerelease', () => {
    assert.strictEqual(toBaseSemVer(' 1.2.3\r '), '1.2.3');
    assert.strictEqual(toBaseSemVer('1.2.3.4'), '1.2.3');
    assert.strictEqual(toBaseSemVer('1.2.3-alpha.1'), '1.2.3');
    assert.strictEqual(toBaseSemVer('bad'), '');
});

test('fails when neither project-file nor release-keyword provided', async () => {
    const r = await runWith({ INPUT_PROJECT_FILE: '', INPUT_RELEASE_KEYWORD: '' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /required when release-keyword/);
});

test('queries releases and finds matching by keyword (tag_name) with default patch bump', async () => {
    const restoreDate = mockDate('2024-10-10T12:34:00Z');
    const restoreHttps = mockHttpsOnce(200, [
        { name: 'Unrelated', tag_name: '0.9.0' },
        { name: 'Important', tag_name: '1.2.3' }
    ]);
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'Important', INPUT_INFIX_VALUE: 'beta' });
    assert.strictEqual(r.exitCode, 0);
    // default increment-type is patch => 1.2.4
    assert.match(r.outputContent, /version_number=1.2.4-beta-202410101234/);
    restoreHttps();
    restoreDate();
});

test('matches keyword in body and extracts semver from name', async () => {
    const restoreDate = mockDate('2024-03-04T05:06:00Z');
    const restoreHttps = mockHttpsOnce(200, [
        { name: 'Release 2.1.0', body: 'Includes Special Feature' }
    ]);
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'special feature', INPUT_INFIX_VALUE: 'beta' });
    assert.strictEqual(r.exitCode, 0);
    // default patch bump from 2.1.0 -> 2.1.1
    assert.match(r.outputContent, /version_number=2.1.1-beta-202403040506/);
    restoreHttps();
    restoreDate();
});

test("queries releases and finds 'initial version' keyword (case-insensitive) with patch bump", async () => {
    const restoreDate = mockDate('2024-02-01T00:00:00Z');
    const restoreHttps = mockHttpsOnce(200, [
        { name: 'Initial Version', tag_name: '1.0.0' },
        { name: 'Other', tag_name: '0.9.0' }
    ]);
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'initial version', INPUT_INFIX_VALUE: 'demo' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=1.0.1-demo-202402010000/);
    restoreHttps();
    restoreDate();
});

test('queries releases but no match, falls back to csproj and bumps patch', async () => {
    const restoreDate = mockDate('2024-01-02T03:04:00Z');
    const restoreHttps = mockHttpsOnce(200, [{ name: 'Other', tag_name: '0.1.0' }]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvp-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>2.3.4-alpha</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'Missing', INPUT_PROJECT_FILE: csproj, INPUT_INFIX_VALUE: 'rc' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=2.3.5-rc-202401020304/);
    restoreHttps();
    restoreDate();
});

test('reads version from csproj when keyword omitted and bumps patch', async () => {
    const restoreDate = mockDate('2023-12-31T23:59:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvc-'));
    const csproj = path.join(dir, 'Lib.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><VersionPrefix>3.4.5.6</VersionPrefix></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_INFIX_VALUE: '' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=3.4.6-202312312359/);
    restoreDate();
});

test('uses default 0.0.1 when no version tags in csproj and bumps to 0.0.2', async () => {
    const restoreDate = mockDate('2025-02-03T04:05:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvd-'));
    const csproj = path.join(dir, 'NoVer.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=0.0.2-202502030405/);
    restoreDate();
});

test('supports increment-type=major', async () => {
    const restoreDate = mockDate('2024-07-08T09:10:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvmj-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_INCREMENT_TYPE: 'major' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=2.0.0-202407080910/);
    restoreDate();
});

test('supports increment-type=minor', async () => {
    const restoreDate = mockDate('2024-07-08T09:10:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvmn-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_INCREMENT_TYPE: 'minor' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=1.3.0-202407080910/);
    restoreDate();
});

test('unknown increment-type uses base version (no bump)', async () => {
    const restoreDate = mockDate('2024-07-08T09:10:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvunk-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_INCREMENT_TYPE: 'weird' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=1.2.3-202407080910/);
    restoreDate();
});

test('skips timestamp when add-timestamp=false (with infix)', async () => {
    const restoreDate = mockDate('2024-07-08T09:10:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvts-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_INFIX_VALUE: 'beta', INPUT_ADD_TIMESTAMP: 'false' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=1.2.4-beta\n/);
    restoreDate();
});

test('skips timestamp when add-timestamp=false (no infix)', async () => {
    const restoreDate = mockDate('2024-07-08T09:10:00Z');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvts2-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj, INPUT_ADD_TIMESTAMP: false });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version_number=1.2.4\n/);
    restoreDate();
});

test('errors on invalid semver in project file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gve-'));
    const csproj = path.join(dir, 'Bad.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>bad.version</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_PROJECT_FILE: csproj });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Invalid semantic base version/);
});

test('errors when project file missing', async () => {
    const r = await runWith({ INPUT_PROJECT_FILE: 'missing.csproj' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Project file not found/);
});

test('propagates GitHub API error', async () => {
    const restoreHttps = mockHttpsOnce(500, { message: 'boom' });
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'kw' });
    assert.strictEqual(r.exitCode, 1);
    // With new logic order, API error is logged but execution continues
    // Since no project file is provided, it fails with invalid base version
    assert.match(r.err, /Invalid semantic base version/);
    restoreHttps();
});

test('404 from releases API treated as no match, fall back to csproj', async () => {
    const restoreDate = mockDate('2024-06-07T08:09:00Z');
    const restoreHttps = mockHttpsOnce(404, {});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvf-'));
    const csproj = path.join(dir, 'Fallback.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>9.8.7</Version></PropertyGroup></Project>');
    const r = await runWith({ INPUT_RELEASE_KEYWORD: 'kw', INPUT_PROJECT_FILE: csproj });
    assert.strictEqual(r.exitCode, 0);
    // default patch bump from 9.8.7 -> 9.8.8
    assert.match(r.outputContent, /version_number=9.8.8-202406070809/);
    restoreHttps();
    restoreDate();
});

test('errors when GITHUB_OUTPUT is not set at write time', async () => {
    // Use withEnvAsync directly to omit GITHUB_OUTPUT
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvo-'));
    const csproj = path.join(dir, 'App.csproj');
    fs.writeFileSync(csproj, '<Project><PropertyGroup><Version>1.2.3</Version></PropertyGroup></Project>');
    const r = await (async () => {
        const prev = { ...process.env };
        Object.assign(process.env, { INPUT_PROJECT_FILE: csproj, GITHUB_REPOSITORY: 'owner/repo' });
        // Ensure GITHUB_OUTPUT is truly absent even on GitHub runners
        delete process.env.GITHUB_OUTPUT;
        let exitCode = 0; const origExit = process.exit; process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
        let out = '', err = ''; const so = process.stdout.write, se = process.stderr.write;
        process.stdout.write = (c, e, cb) => { out += c; return true; }; process.stderr.write = (c, e, cb) => { err += c; return true; };
        try { try { await run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; } } finally { process.env = prev; process.exit = origExit; process.stdout.write = so; process.stderr.write = se; }
        return { exitCode, out, err };
    })();
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_OUTPUT not set/);
});

test('errors when release-keyword present but GITHUB_REPOSITORY missing', async () => {
    const r = await withEnvAsync({ INPUT_RELEASE_KEYWORD: 'kw', GITHUB_OUTPUT: path.join(os.tmpdir(), 'out.txt'), GITHUB_REPOSITORY: '' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_REPOSITORY not set/);
});
