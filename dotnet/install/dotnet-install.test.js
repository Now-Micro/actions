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
