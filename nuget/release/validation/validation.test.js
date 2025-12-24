const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const { run } = require('./validation');

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

function runWith(env = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrv-'));
    const outFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outFile, '');
    const r = withEnv({ ...env, GITHUB_OUTPUT: outFile }, () => run());
    r.outputContent = fs.readFileSync(outFile, 'utf8');
    return r;
}

test('workflow_dispatch success uses provided package and version', () => {
    const r = runWith({
        INPUT_EVENT_NAME: 'workflow_dispatch',
        INPUT_PACKAGE: 'MyLib',
        INPUT_VERSION: '1.2.3-beta.1'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=1.2.3-beta.1/);
    assert.match(r.outputContent, /library_name=MyLib/);
});

test('workflow_dispatch missing version exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'workflow_dispatch', INPUT_PACKAGE: 'Lib' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_VERSION is required/);
});

test('workflow_dispatch invalid version exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'workflow_dispatch', INPUT_PACKAGE: 'Lib', INPUT_VERSION: '1.2' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid semantic version/);
});

test('workflow_dispatch missing package exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'workflow_dispatch', INPUT_VERSION: '1.2.3' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_PACKAGE is required/);
});

test('branch success parses library and version', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'push', INPUT_REF_NAME: 'release/Api/2.3.4' });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=2.3.4/);
    assert.match(r.outputContent, /library_name=Api/);
});

test('branch invalid format exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'push', INPUT_REF_NAME: 'main' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid release branch name/);
});

test('branch invalid version exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'push', INPUT_REF_NAME: 'release/Api/1.0' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid semantic version/);
});

test('missing event name exits 1', () => {
    const r = runWith({ INPUT_EVENT_NAME: '' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_EVENT_NAME is required/);
});

test('missing ref name exits 1 when not workflow_dispatch', () => {
    const r = runWith({ INPUT_EVENT_NAME: 'push', INPUT_REF_NAME: '' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_REF_NAME is required/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const r = withEnv({ INPUT_EVENT_NAME: 'push', INPUT_REF_NAME: 'release/Lib/1.0.0' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /GITHUB_OUTPUT not set/);
});

test('debug mode logs inputs', () => {
    const r = runWith({
        INPUT_EVENT_NAME: 'workflow_dispatch',
        INPUT_PACKAGE: 'Pkg',
        INPUT_VERSION: '1.0.0',
        INPUT_DEBUG_MODE: 'true'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug: eventName=/);
    assert.match(r.out, /Debug: parsed from manual inputs/);
});

test('debug mode logs branch parsing', () => {
    const r = runWith({
        INPUT_EVENT_NAME: 'push',
        INPUT_REF_NAME: 'release/Lib/3.2.1',
        INPUT_DEBUG_MODE: 'true'
    });
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug: parsed from branch name/);
});

test('cli entrypoint works end-to-end', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrv-cli-'));
    const outFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outFile, '');
    childProcess.execFileSync(process.execPath, [path.join(__dirname, 'validation.js')], {
        env: {
            ...process.env,
            GITHUB_OUTPUT: outFile,
            INPUT_EVENT_NAME: 'workflow_dispatch',
            INPUT_PACKAGE: 'CliPkg',
            INPUT_VERSION: '9.9.9'
        }
    });
    const contents = fs.readFileSync(outFile, 'utf8');
    assert.match(contents, /version=9.9.9/);
    assert.match(contents, /library_name=CliPkg/);
});
