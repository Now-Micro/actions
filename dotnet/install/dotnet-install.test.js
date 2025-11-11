const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, __setExecSync } = require('./dotnet-install');

function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try { return fn(); } finally { process.env = prev; }
}

function captureExit(fn) {
    const origExit = process.exit;
    let code;
    process.exit = c => { code = c || 0; throw new Error(`__EXIT_${code}__`); };
    try { fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    finally { process.exit = origExit; }
    return code;
}

test('errors when INPUT_DOTNET_VERSION missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    const code = captureExit(() => withEnv({ GITHUB_PATH: ghPath }, () => run()));
    assert.strictEqual(code, 1);
});

test('installs versions and appends to GITHUB_PATH', () => {
    const called = [];
    __setExecSync((cmd, opts) => {
        called.push(cmd);
        return Buffer.from('ok');
    });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');

    withEnv({ INPUT_DOTNET_VERSION: '6.0.x,7.0.100', GITHUB_PATH: ghPath, HOME: tmp }, () => run());

    const content = fs.readFileSync(ghPath, 'utf8');
    assert.ok(content.includes('.dotnet'));
    // check that installer was downloaded and both installs invoked
    assert.ok(called.some(c => c.includes('dotnet-install.sh')));
    assert.ok(called.some(c => c.includes('--channel')));
    assert.ok(called.some(c => c.includes('--version')));
});

test('cleans up temp directory', () => {
    // Use a real exec that just returns but create a temp dir inside run and ensure it's removed
    __setExecSync(() => Buffer.from('ok'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    // run and capture tmp dirs created beneath os.tmpdir()
    const before = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dotnet-install-'));
    withEnv({ INPUT_DOTNET_VERSION: '6.0.x', GITHUB_PATH: ghPath, HOME: tmp }, () => run());
    const after = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dotnet-install-'));
    // there should be no new lingering dotnet-install- folders (best-effort)
    assert.ok(after.length <= before.length);
});

test('errors when no versions parsed (empty string after trim)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '  ,  , ', GITHUB_PATH: ghPath }, () => run()));
    assert.strictEqual(code, 1);
});

test('errors when install dir creation fails', () => {
    __setExecSync(() => Buffer.from('ok'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    // create a file at the install dir path to cause mkdir to fail
    const badInstallDir = path.join(tmp, '.dotnet');
    fs.writeFileSync(badInstallDir, 'blocking file');
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '6.0.x', GITHUB_PATH: ghPath, HOME: tmp }, () => run()));
    assert.strictEqual(code, 1);
});

test('errors when installer download fails', () => {
    __setExecSync((cmd) => {
        if (cmd.includes('curl')) {
            throw new Error('curl failed');
        }
        return Buffer.from('ok');
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '6.0.x', GITHUB_PATH: ghPath, HOME: tmp }, () => run()));
    assert.strictEqual(code, 1);
});

test('errors when GITHUB_PATH not set', () => {
    __setExecSync(() => Buffer.from('ok'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    // Save and explicitly delete GITHUB_PATH to test missing env var
    const savedPath = process.env.GITHUB_PATH;
    delete process.env.GITHUB_PATH;
    try {
        const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '6.0.x', HOME: tmp }, () => run()));
        assert.strictEqual(code, 1);
    } finally {
        if (savedPath !== undefined) process.env.GITHUB_PATH = savedPath;
    }
});

test('uses os.homedir() when HOME not set', () => {
    const called = [];
    __setExecSync((cmd) => {
        called.push(cmd);
        return Buffer.from('ok');
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    // Don't set HOME, so code falls back to os.homedir()
    const env = { INPUT_DOTNET_VERSION: '8.0.100', GITHUB_PATH: ghPath };
    delete env.HOME;
    withEnv(env, () => run());
    const content = fs.readFileSync(ghPath, 'utf8');
    assert.ok(content.includes('.dotnet'));
});

test('installs exact version (non-.x version)', () => {
    const called = [];
    __setExecSync((cmd) => {
        called.push(cmd);
        return Buffer.from('ok');
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    withEnv({ INPUT_DOTNET_VERSION: '8.0.100', GITHUB_PATH: ghPath, HOME: tmp }, () => run());
    // Verify the --version flag was used (not --channel)
    assert.ok(called.some(c => c.includes('--version') && c.includes('8.0.100')));
    assert.ok(!called.some(c => c.includes('--channel')));
});

test('handles download error without message property', () => {
    __setExecSync((cmd) => {
        if (cmd.includes('curl')) {
            const err = new Error();
            delete err.message; // remove message property
            throw err;
        }
        return Buffer.from('ok');
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '6.0.x', GITHUB_PATH: ghPath, HOME: tmp }, () => run()));
    assert.strictEqual(code, 1);
});

test('skips empty version strings in list', () => {
    const called = [];
    __setExecSync((cmd) => {
        called.push(cmd);
        return Buffer.from('ok');
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');
    // Mix of valid and empty (after trim) versions
    withEnv({ INPUT_DOTNET_VERSION: '6.0.x,  , 7.0.100, ', GITHUB_PATH: ghPath, HOME: tmp }, () => run());
    // Should install 6.0.x and 7.0.100, skipping the empty entries
    const installCalls = called.filter(c => c.includes('bash') && c.includes('dotnet-install.sh'));
    assert.strictEqual(installCalls.length, 2);
});

test('finally block handles rmSync failure gracefully', () => {
    // Mock fs.rmSync to throw an error
    const origRmSync = fs.rmSync;
    let rmSyncCalled = false;
    fs.rmSync = (p, opts) => {
        rmSyncCalled = true;
        throw new Error('rmSync simulated failure');
    };

    __setExecSync(() => Buffer.from('ok'));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghPath = path.join(tmp, 'out');
    fs.writeFileSync(ghPath, '');

    try {
        // This should complete without throwing despite rmSync failure
        withEnv({ INPUT_DOTNET_VERSION: '6.0.x', GITHUB_PATH: ghPath, HOME: tmp }, () => run());
        assert.ok(rmSyncCalled, 'rmSync should have been called');
    } finally {
        fs.rmSync = origRmSync;
    }
});
