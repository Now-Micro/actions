const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, copyPackages, buildReleaseNotes } = require('./github-release');

const ROOT_RELEASE_NOTES = path.join(process.cwd(), 'RELEASE_NOTES.md');

function cleanupRootReleaseNotes() {
    if (fs.existsSync(ROOT_RELEASE_NOTES)) {
        try {
            fs.rmSync(ROOT_RELEASE_NOTES);
        } catch (_) {
            // Best-effort cleanup; ignore errors.
        }
    }
}

function makeTempDir(prefix = 'gh-rel-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWithEnv(env) {
    cleanupRootReleaseNotes();
    const tmp = makeTempDir('gh-rel-out-');
    const outFile = path.join(tmp, 'out.txt');
    fs.writeFileSync(outFile, '');
    const prev = { ...process.env };
    const prevCwd = process.cwd();
    Object.keys(process.env).filter(k => k.startsWith('INPUT_')).forEach(k => delete process.env[k]);
    const bodyPath = env.INPUT_BODY_FILENAME || path.join(tmp, 'RELEASE_NOTES.md');
    Object.assign(process.env, env, { GITHUB_OUTPUT: outFile, INPUT_BODY_FILENAME: bodyPath });
    process.chdir(tmp);

    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return true; };
    process.stderr.write = (c, e, cb) => { err += c; return true; };

    try {
        try { run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.chdir(prevCwd);
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
        cleanupRootReleaseNotes();
    }

    const outputContent = fs.readFileSync(outFile, 'utf8');
    return { exitCode, out, err, outputContent };
}

function parseOutput(content) {
    const entries = content
        .split(/\n/)
        .filter(Boolean)
        .map(l => {
            const idx = l.indexOf('=');
            if (idx === -1) {
                // No separator found; treat whole line as key with empty value.
                return [l, ''];
            }
            const key = l.slice(0, idx);
            const value = l.slice(idx + 1);
            return [key, value];
        });
    return Object.fromEntries(entries);
}

test('copies packages, builds notes, and emits outputs', () => {
    const root = makeTempDir('gh-rel-src-');
    const artifacts = path.join(root, 'artifacts');
    const sub = path.join(artifacts, 'nested');
    const packagesPath = path.join(root, 'packages');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'one.nupkg'), 'a');
    fs.writeFileSync(path.join(sub, 'two.snupkg'), 'b');
    fs.writeFileSync(path.join(sub, 'ignore.txt'), 'x');
    const changelog = path.join(artifacts, 'CHANGELOG.md');
    fs.writeFileSync(changelog, 'changelog content');

    const r = runWithEnv({
        INPUT_LIBRARY_NAME: 'Demo.Lib',
        INPUT_RELEASE_VERSION: '1.2.3',
        INPUT_ARTIFACTS_PATH: artifacts,
        INPUT_PACKAGES_PATH: packagesPath,
        INPUT_CHANGELOG_PATH: changelog,
        INPUT_BODY_FILENAME: path.join(root, 'NOTES.md'),
    });

    assert.strictEqual(r.exitCode, 0);
    const outputs = parseOutput(r.outputContent);
    assert.strictEqual(outputs.has_packages, '2');
    assert.deepStrictEqual(JSON.parse(outputs.packages_json), ['one.nupkg', 'two.snupkg']);
    assert.strictEqual(outputs.tag_name, 'Demo.Lib-v1.2.3');
    assert.strictEqual(outputs.release_name, 'Demo.Lib v1.2.3');
    assert.ok(fs.existsSync(outputs.release_notes_path));
    const notes = fs.readFileSync(outputs.release_notes_path, 'utf8');
    assert.match(notes, /one\.nupkg/);
    assert.match(notes, /two\.snupkg/);
    assert.match(notes, /changelog content/);
    assert.ok(fs.existsSync(path.join(packagesPath, 'one.nupkg')));
    assert.ok(fs.existsSync(path.join(packagesPath, 'two.snupkg')));
});


test('handles missing artifacts and writes empty outputs', () => {
    const root = makeTempDir('gh-rel-missing-');
    const artifacts = path.join(root, 'missing');
    const packagesPath = path.join(root, 'packages');

    const r = runWithEnv({
        INPUT_LIBRARY_NAME: 'Demo.Lib',
        INPUT_RELEASE_VERSION: '2.0.0',
        INPUT_ARTIFACTS_PATH: artifacts,
        INPUT_PACKAGES_PATH: packagesPath,
    });

    assert.strictEqual(r.exitCode, 0);
    const outputs = parseOutput(r.outputContent);
    assert.strictEqual(outputs.has_packages, '0');
    assert.deepStrictEqual(JSON.parse(outputs.packages_json), []);
    const notes = fs.readFileSync(outputs.release_notes_path, 'utf8');
    assert.match(notes, /No packages found/);
});


test('fails when required inputs are missing', () => {
    const r = runWithEnv({ INPUT_RELEASE_VERSION: '1.0.0' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_LIBRARY_NAME is required/);
});


test('copyPackages matches expected extensions', () => {
    const root = makeTempDir('gh-rel-copy-');
    const artifacts = path.join(root, 'artifacts');
    fs.mkdirSync(artifacts);
    fs.writeFileSync(path.join(artifacts, 'a.nupkg'), 'a');
    fs.writeFileSync(path.join(artifacts, 'b.snupkg'), 'b');
    fs.writeFileSync(path.join(artifacts, 'c.symbols.nupkg'), 'c');
    fs.writeFileSync(path.join(artifacts, 'd.txt'), 'd');
    const dest = path.join(root, 'dest');
    const copied = copyPackages(artifacts, dest);
    assert.deepStrictEqual(copied.sort(), ['a.nupkg', 'b.snupkg', 'c.symbols.nupkg'].sort());
});


test('buildReleaseNotes handles missing changelog', () => {
    const root = makeTempDir('gh-rel-notes-');
    const notesPath = buildReleaseNotes({
        libraryName: 'Lib',
        releaseVersion: '0.1.0',
        packages: [],
        changelogPath: path.join(root, 'missing.md'),
        bodyFilename: path.join(root, 'NOTES.md'),
    });
    const notes = fs.readFileSync(notesPath, 'utf8');
    assert.match(notes, /No packages found/);
    assert.match(notes, /No changelog content found/);
});


test('run honors custom tag prefix and release name template', () => {
    const root = makeTempDir('gh-rel-custom-');
    const artifacts = path.join(root, 'artifacts');
    const packagesPath = path.join(root, 'packages');
    fs.mkdirSync(artifacts);
    fs.writeFileSync(path.join(artifacts, 'only.nupkg'), 'x');

    const r = runWithEnv({
        INPUT_LIBRARY_NAME: 'LibX',
        INPUT_RELEASE_VERSION: '9.9.9',
        INPUT_ARTIFACTS_PATH: artifacts,
        INPUT_PACKAGES_PATH: packagesPath,
        INPUT_TAG_PREFIX: 'v',
        INPUT_RELEASE_NAME_TEMPLATE: '{release-version} - {library-name}',
    });

    assert.strictEqual(r.exitCode, 0);
    const outputs = parseOutput(r.outputContent);
    assert.strictEqual(outputs.tag_name, 'v9.9.9');
    assert.strictEqual(outputs.release_name, '9.9.9 - LibX');
});


test('run exits when GITHUB_OUTPUT is missing', () => {
    const prev = { ...process.env };
    Object.assign(process.env, {
        INPUT_LIBRARY_NAME: 'Lib',
        INPUT_RELEASE_VERSION: '1.0.0',
    });
    delete process.env.GITHUB_OUTPUT;
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    process.stdout.write = (c, e, cb) => { out += c; return true; };
    process.stderr.write = (c, e, cb) => { err += c; return true; };
    try {
        try { run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }
    assert.strictEqual(exitCode, 1);
    assert.match(err + out, /GITHUB_OUTPUT not set/);
});


test('run exits when release version is missing', () => {
    const r = runWithEnv({ INPUT_LIBRARY_NAME: 'Demo.Lib' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_RELEASE_VERSION is required/);
});


test('listFilesRecursive logs and skips unreadable directory', () => {
    const root = makeTempDir('gh-rel-list-');
    const good = path.join(root, 'good');
    const bad = path.join(root, 'bad');
    fs.mkdirSync(good, { recursive: true });
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(good, 'ok.txt'), 'x');

    const origReaddir = fs.readdirSync;
    const logs = [];
    const origError = console.error;
    console.error = msg => logs.push(msg);
    fs.readdirSync = (p, opts) => {
        if (p === bad) {
            throw new Error('boom');
        }
        return origReaddir(p, opts);
    };
    try {
        const files = require('./github-release').listFilesRecursive(root);
        const norm = files.map(f => f.split(path.sep).pop());
        assert.deepStrictEqual(norm, ['ok.txt']);
        assert.ok(logs.some(l => l.includes('Cannot read directory')));
    } finally {
        fs.readdirSync = origReaddir;
        console.error = origError;
    }
});


test('debug mode emits config and package logs', () => {
    const root = makeTempDir('gh-rel-debug-');
    const artifacts = path.join(root, 'artifacts');
    const packagesPath = path.join(root, 'packages');
    fs.mkdirSync(artifacts);
    fs.writeFileSync(path.join(artifacts, 'dbg.nupkg'), 'x');

    const r = runWithEnv({
        INPUT_LIBRARY_NAME: 'Dbg',
        INPUT_RELEASE_VERSION: '0.0.1',
        INPUT_ARTIFACTS_PATH: artifacts,
        INPUT_PACKAGES_PATH: packagesPath,
        INPUT_DEBUG_MODE: 'true',
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug: library=Dbg version=0.0.1/);
    assert.match(r.out, /Debug: artifactsPath=/);
    assert.match(r.out, /Debug: packagesPath=/);
    assert.match(r.out, /Debug: copied packages/);
    assert.match(r.out, /dbg\.nupkg/);
    assert.match(r.out, /Debug: release notes path/);
    assert.match(r.out, /Debug: tagName=Dbg-v0\.0\.1/);
    assert.match(r.out, /Debug: releaseName=/);
});
