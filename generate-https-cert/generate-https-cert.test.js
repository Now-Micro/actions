const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { run } = require('./generate-https-cert');

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

function runWith(env = {}, options = {}) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcert-'));
    const outFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outFile, '');
    const envBase = { ...env, GITHUB_OUTPUT: outFile, GITHUB_WORKSPACE: tmpDir };
    if (options.includeDefaultCert !== false && !Object.prototype.hasOwnProperty.call(envBase, 'INPUT_CERT_PATH')) {
        envBase.INPUT_CERT_PATH = 'certs/aspnetapp.pfx';
    }
    const r = withEnv(envBase, () => run());
    r.outputFile = outFile;
    r.outputContent = fs.readFileSync(outFile, 'utf8');
    r.workspaceDir = tmpDir;
    return r;
}

function stubExecSync(fn) {
    const cp = require('child_process');
    const original = cp.execSync;
    cp.execSync = fn;
    return () => { cp.execSync = original; };
}

function stubChmodSync(fn) {
    const original = fs.chmodSync;
    fs.chmodSync = fn;
    return () => { fs.chmodSync = original; };
}

function makeDotnetStub({ throwError } = {}) {
    const history = [];
    const restore = stubExecSync((cmd, opts) => {
        history.push(cmd);
        if (throwError) {
            throw new Error('dotnet failure');
        }
        const match = cmd.match(/-ep\s+"?([^"\s]+)"?/);
        if (match) {
            const certFile = match[1];
            const cwd = (opts && opts.cwd) || process.cwd();
            const full = path.isAbsolute(certFile) ? certFile : path.join(cwd, certFile);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, 'FAKECERT');
        }
        return Buffer.from('');
    });
    return { restore, getHistory: () => history };
}

test('missing password exits 1', () => {
    const r = runWith({});
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /CERT_PASSWORD is required/);
});

test('missing cert path exits 1', () => {
    const r = runWith({ CERT_PASSWORD: 'pw' }, { includeDefaultCert: false });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_CERT_PATH is required/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const r = withEnv({ INPUT_CERT_PATH: 'certs/aspnetapp.pfx', CERT_PASSWORD: 'pw', GITHUB_OUTPUT: '' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /GITHUB_OUTPUT not set/);
});

test('success writes output and calls dotnet', () => {
    const { restore } = makeDotnetStub();
    const r = runWith({ CERT_PASSWORD: 'pw' });
    restore();
    assert.strictEqual(r.exitCode, 0);
    const out = fs.readFileSync(r.outputFile, 'utf8');
    assert.match(out, /cert-path=certs\/aspnetapp.pfx/);
    const certFile = path.join(r.workspaceDir, 'certs', 'aspnetapp.pfx');
    assert.ok(fs.existsSync(certFile));
});

test('prefers INPUT_CERT_PASSWORD over env', () => {
    const { restore } = makeDotnetStub();
    const r = runWith({ INPUT_CERT_PASSWORD: 'pw', INPUT_CERT_PATH: 'custom/input.pfx' });
    restore();
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /cert-path=custom\/input.pfx/);
});

test('captures password in dotnet command', () => {
    const { restore, getHistory } = makeDotnetStub();
    const r = runWith({ INPUT_CERT_PASSWORD: 'pw123', INPUT_CERT_PATH: 'secret.pfx' });
    restore();
    assert.strictEqual(r.exitCode, 0);
    const history = getHistory();
    const exportCmd = history.find(cmd => /-ep/.test(cmd));
    assert.match(exportCmd, /-p "pw123"/);
});

test('falls back to WORKSPACE_DIR when no input workspace', () => {
    const { restore } = makeDotnetStub();
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-dir-'));
    const r = runWith({ CERT_PASSWORD: 'pw', WORKSPACE_DIR: customDir });
    restore();
    const certFile = path.join(customDir, 'certs', 'aspnetapp.pfx');
    assert.ok(fs.existsSync(certFile));
    assert.match(r.outputContent, /cert-path=certs\/aspnetapp.pfx/);
});

test('uses INPUT_WORKSPACE_DIR path', () => {
    test('force-new-cert triggers clean command', () => {
        const { restore, getHistory } = makeDotnetStub();
        const r = runWith({ CERT_PASSWORD: 'pw', INPUT_FORCE_NEW_CERT: 'true' });
        restore();
        assert.strictEqual(r.exitCode, 0);
        const history = getHistory();
        assert.ok(history[0].includes('dotnet dev-certs https --clean'));
        assert.ok(history[1].includes('-ep')); // ensure export still ran
    });

    test('force-new-cert default skips clean', () => {
        const { restore, getHistory } = makeDotnetStub();
        const r = runWith({ CERT_PASSWORD: 'pw' });
        restore();
        assert.strictEqual(r.exitCode, 0);
        const history = getHistory();
        assert.ok(history.every(cmd => !/--clean/.test(cmd)));
    });
    const { restore } = makeDotnetStub();
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), 'input-dir-'));
    const r = runWith({ INPUT_CERT_PASSWORD: 'pw', INPUT_WORKSPACE_DIR: customDir, INPUT_CERT_PATH: 'mycerts/out.pfx' });
    restore();
    const certFile = path.join(customDir, 'mycerts', 'out.pfx');
    assert.ok(fs.existsSync(certFile));
    assert.match(r.outputContent, /cert-path=mycerts\/out.pfx/);
});

test('dotnet failures exit 1', () => {
    const { restore } = makeDotnetStub({ throwError: true });
    const r = runWith({ CERT_PASSWORD: 'pw' });
    restore();
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /dotnet failure/);
});

test('ignores chmod errors', () => {
    const { restore } = makeDotnetStub();
    const restoreChmod = stubChmodSync(() => { throw new Error('chmod fail'); });
    const r = runWith({ CERT_PASSWORD: 'pw' });
    restore();
    restoreChmod();
    assert.strictEqual(r.exitCode, 0);
});

test('debug mode logs verbose details', () => {
    const { restore } = makeDotnetStub();
    const r = runWith({ CERT_PASSWORD: 'pw', INPUT_DEBUG_MODE: 'true' });
    restore();
    assert.match(r.out, /Debug: certPath=/);
    assert.match(r.out, /Debug: resolved path=/);
    assert.match(r.out, /Debug: working directory=/);
    assert.match(r.out, /Debug: will run dotnet dev-certs https -ep/);
    assert.match(r.out, /Debug: outputs appended to/);
});

test('debug mode off keeps logs quiet', () => {
    const { restore } = makeDotnetStub();
    const r = runWith({ CERT_PASSWORD: 'pw', INPUT_DEBUG_MODE: 'false' });
    restore();
    assert.ok(!/Debug:/.test(r.out));
});
