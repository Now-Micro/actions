const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, copyPackages, buildReleaseNotes } = require('./github-release');

function makeTempDir(prefix = 'gh-rel-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWithEnv(env) {
    const tmp = makeTempDir('gh-rel-out-');
    const outFile = path.join(tmp, 'out.txt');
    fs.writeFileSync(outFile, '');
    const prev = { ...process.env };
    Object.keys(process.env).filter(k => k.startsWith('INPUT_')).forEach(k => delete process.env[k]);
    Object.assign(process.env, env, { GITHUB_OUTPUT: outFile });

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

    const outputContent = fs.readFileSync(outFile, 'utf8');
    return { exitCode, out, err, outputContent };
}

function parseOutput(content) {
    const lines = Object.fromEntries(content.split(/\n/).filter(Boolean).map(l => l.split('=')));
    return lines;
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
