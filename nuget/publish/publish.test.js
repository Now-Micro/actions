const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./publish');

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

function mkpkg(tmp, options = {}) {
    const includeSymbols = options.includeSymbols !== undefined ? options.includeSymbols : true;
    const includeLegacySymbols = options.includeLegacySymbols || false;
    const nupkgs = path.join(tmp, 'nupkgs');
    fs.mkdirSync(nupkgs, { recursive: true });
    fs.writeFileSync(path.join(nupkgs, 'A.1.0.0.nupkg'), 'x');
    fs.writeFileSync(path.join(nupkgs, 'B.2.0.0.nupkg'), 'y');
    if (includeSymbols) {
        fs.writeFileSync(path.join(nupkgs, 'A.1.0.0.snupkg'), 'sx');
        fs.writeFileSync(path.join(nupkgs, 'B.2.0.0.snupkg'), 'sy');
    }
    if (includeLegacySymbols) {
        fs.writeFileSync(path.join(nupkgs, 'A.1.0.0.symbols.nupkg'), 'osx');
        fs.writeFileSync(path.join(nupkgs, 'B.2.0.0.symbols.nupkg'), 'osy');
    }
    return nupkgs;
}

test('errors when pkg dir missing (ENOENT triggers catch)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    // No nupkgs folder created
    const r = withEnv({ GITHUB_WORKSPACE: tmp }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /ENOENT|no such file or directory/i);
});

test('fails when no nupkg files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    fs.mkdirSync(path.join(tmp, 'nupkgs'));
    const r = withEnv({ GITHUB_WORKSPACE: tmp }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /No \.nupkg files found/);
});

test('local publish copies to folder (relative)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    const destRel = '.artifacts/local';
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: destRel }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const dest = path.join(tmp, destRel);
    assert.ok(fs.existsSync(path.join(dest, 'A.1.0.0.nupkg')));
    assert.ok(fs.existsSync(path.join(dest, 'B.2.0.0.nupkg')));
    assert.ok(fs.existsSync(path.join(dest, 'A.1.0.0.snupkg')));
    assert.ok(fs.existsSync(path.join(dest, 'B.2.0.0.snupkg')));
});

test('local publish copies legacy symbol packages when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp, { includeLegacySymbols: true });
    const destRel = '.artifacts/local-legacy';
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: destRel }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const dest = path.join(tmp, destRel);
    assert.ok(fs.existsSync(path.join(dest, 'A.1.0.0.symbols.nupkg')));
    assert.ok(fs.existsSync(path.join(dest, 'B.2.0.0.symbols.nupkg')));
});

test('local publish reads from INPUT_PACKAGE_DIRECTORY override', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    const pkgDir = path.join(tmp, 'custom_pkgs');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'A.1.0.0.nupkg'), 'x');
    const destRel = '.artifacts/local2';
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: destRel, INPUT_PACKAGE_DIRECTORY: pkgDir }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const dest = path.join(tmp, destRel);
    assert.ok(fs.existsSync(path.join(dest, 'A.1.0.0.nupkg')));
});

test('local publish copies to absolute path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    const absDest = path.join(tmp, 'abs', 'out');
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: absDest }, () => run());
    assert.strictEqual(r.exitCode, 0);
    assert.ok(fs.existsSync(path.join(absDest, 'A.1.0.0.nupkg')));
    assert.ok(fs.existsSync(path.join(absDest, 'B.2.0.0.nupkg')));
    assert.ok(fs.existsSync(path.join(absDest, 'A.1.0.0.snupkg')));
    assert.ok(fs.existsSync(path.join(absDest, 'B.2.0.0.snupkg')));
});

test('default target requires owner when publish-source empty', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    const r = withEnv({ GITHUB_WORKSPACE: tmp, GITHUB_REPOSITORY_OWNER: '' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_REPOSITORY_OWNER is not set/);
});

test('remote publish attempts push and fails without dotnet', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: 'https://example.com/index.json', INPUT_GITHUB_TOKEN: 'tok_abc123xyz' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /dotnet nuget push failed/);
});

test('remote publish requires token', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    const r = withEnv({ GITHUB_WORKSPACE: tmp, INPUT_PUBLISH_SOURCE: 'https://example.com/index.json' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_GITHUB_TOKEN is required/);
});

test('remote publish success path logs and masks token', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp);
    // Stub spawnSync BEFORE requiring the module so destructured reference uses the stub
    const cp = require('child_process');
    const orig = cp.spawnSync;
    cp.spawnSync = () => ({ status: 0 });
    delete require.cache[require.resolve('./publish')];
    const { run: runStubbed } = require('./publish');
    const r = withEnv({
        GITHUB_WORKSPACE: tmp,
        INPUT_PUBLISH_SOURCE: 'https://example.com/index.json',
        INPUT_GITHUB_TOKEN: 'tok_abc123xyz'
    }, () => runStubbed());
    cp.spawnSync = orig;
    delete require.cache[require.resolve('./publish')];
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Remote publish using dotnet/);
    assert.match(r.out, /api-key: tok…xyz/);
    assert.match(r.out, /Push completed successfully/);
});

test('remote publish pushes symbol packages when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npub-'));
    mkpkg(tmp, { includeLegacySymbols: true });
    const cp = require('child_process');
    const orig = cp.spawnSync;
    const calls = [];
    cp.spawnSync = (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; };
    delete require.cache[require.resolve('./publish')];
    const { run: runStubbed } = require('./publish');
    const r = withEnv({
        GITHUB_WORKSPACE: tmp,
        INPUT_PUBLISH_SOURCE: 'https://example.com/index.json',
        INPUT_GITHUB_TOKEN: 'tok_abc123xyz'
    }, () => runStubbed());
    cp.spawnSync = orig;
    delete require.cache[require.resolve('./publish')];
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(calls.length, 3);
    assert.ok(calls[0].args[2].endsWith('*.nupkg'));
    assert.ok(calls[1].args[2].endsWith('*.snupkg'));
    assert.ok(calls[2].args[2].endsWith('*.symbols.nupkg'));
});
