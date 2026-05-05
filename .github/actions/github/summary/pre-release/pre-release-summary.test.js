'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { run, buildSummary, findPackages, extractPackageInfo, parseChangedDirs } = require('./pre-release-summary');

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

function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'pre-release-summary-'));
}

function makeSummaryFile(dir) {
    const f = path.join(dir, 'summary.md');
    fs.writeFileSync(f, '');
    return f;
}

// --- parseChangedDirs ---

test('parseChangedDirs - empty string returns null (directory mode)', () => {
    assert.strictEqual(parseChangedDirs(''), null);
});

test('parseChangedDirs - whitespace-only string returns null', () => {
    assert.strictEqual(parseChangedDirs('   '), null);
});

test('parseChangedDirs - empty JSON array returns empty array', () => {
    assert.deepStrictEqual(parseChangedDirs('[]'), []);
});

test('parseChangedDirs - JSON array with entries returns array', () => {
    assert.deepStrictEqual(parseChangedDirs('["src/Api","src/Lib"]'), ['src/Api', 'src/Lib']);
});

test('parseChangedDirs - invalid JSON returns null', () => {
    assert.strictEqual(parseChangedDirs('not-json'), null);
});

test('parseChangedDirs - JSON non-array returns null', () => {
    assert.strictEqual(parseChangedDirs('{"key":"val"}'), null);
});

// --- extractPackageInfo ---

test('extractPackageInfo - semver with prerelease label', () => {
    const result = extractPackageInfo('/some/path/MyPackage.1.2.3-alpha.1.nupkg');
    assert.strictEqual(result.fileName, 'MyPackage.1.2.3-alpha.1.nupkg');
    assert.strictEqual(result.packageId, 'MyPackage');
    assert.strictEqual(result.version, '1.2.3-alpha.1');
});

test('extractPackageInfo - plain semver no prerelease', () => {
    const result = extractPackageInfo('Foo.Bar.1.0.0.nupkg');
    assert.strictEqual(result.packageId, 'Foo.Bar');
    assert.strictEqual(result.version, '1.0.0');
});

test('extractPackageInfo - fallback when no semver match', () => {
    const result = extractPackageInfo('SomePackage.custom.nupkg');
    assert.strictEqual(result.packageId, 'SomePackage');
    assert.strictEqual(result.version, 'custom');
});

test('extractPackageInfo - no dot fallback returns empty version', () => {
    const result = extractPackageInfo('nodot.nupkg');
    assert.strictEqual(result.packageId, 'nodot');
    assert.strictEqual(result.version, '');
});

test('extractPackageInfo - multi-part package id with semver', () => {
    const result = extractPackageInfo('My.Company.Library.2.0.1-rc.3.nupkg');
    assert.strictEqual(result.packageId, 'My.Company.Library');
    assert.strictEqual(result.version, '2.0.1-rc.3');
});

// --- findPackages ---

test('findPackages - non-existent directory returns empty array', () => {
    const result = findPackages('/this/path/does/not/exist');
    assert.deepStrictEqual(result, []);
});

test('findPackages - empty directory returns empty array', () => {
    const tmp = makeTmpDir();
    assert.deepStrictEqual(findPackages(tmp), []);
});

test('findPackages - finds nupkg files at root of directory', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'Pkg.1.0.0.nupkg'), '');
    const result = findPackages(tmp);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].endsWith('Pkg.1.0.0.nupkg'));
});

test('findPackages - finds nupkg files recursively in subdirectories', () => {
    const tmp = makeTmpDir();
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'Pkg.1.0.0.nupkg'), '');
    fs.writeFileSync(path.join(tmp, 'sub', 'Other.2.0.0.nupkg'), '');
    fs.writeFileSync(path.join(tmp, 'readme.txt'), '');
    const result = findPackages(tmp);
    assert.strictEqual(result.length, 2);
    assert.ok(result.some(f => f.endsWith('Pkg.1.0.0.nupkg')));
    assert.ok(result.some(f => f.endsWith('Other.2.0.0.nupkg')));
});

test('findPackages - ignores non-nupkg files', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'Pkg.1.0.0.snupkg'), '');
    fs.writeFileSync(path.join(tmp, 'readme.md'), '');
    fs.writeFileSync(path.join(tmp, 'Pkg.1.0.0.nupkg.bak'), '');
    assert.deepStrictEqual(findPackages(tmp), []);
});

// --- buildSummary ---

test('buildSummary - changedDirs=[] shows no-changes message and omits package sections', () => {
    const summary = buildSummary({
        branch: 'main',
        prereleaseIdentifier: 'alpha',
        baseRef: 'main',
        eventName: 'workflow_dispatch',
        changedDirs: '[]',   // JSON empty array string → change detection found nothing
        repository: 'org/repo',
        repositoryOwner: 'org',
        artifactsDir: '/nonexistent',
    });
    assert.ok(summary.includes('No libraries with changes detected'));
    assert.ok(!summary.includes('📦 Pre-release Packages Generated'));
    assert.ok(!summary.includes('📥 Installation'));
});

test('buildSummary - changedDirs with entries shows packages section', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'Api.1.0.0-alpha.nupkg'), '');
    const summary = buildSummary({
        branch: 'main',
        prereleaseIdentifier: 'alpha',
        baseRef: 'main',
        eventName: 'push',
        changedDirs: '["src/Api"]',   // parsed → ["src/Api"], shows packages section
        repository: 'org/repo',
        repositoryOwner: 'org',
        artifactsDir: tmp,
    });
    assert.ok(summary.includes('📦 Pre-release Packages Generated'));
    assert.ok(summary.includes('Api.1.0.0-alpha.nupkg'));
});

test('buildSummary - directory mode (changedDirs="") with no artifacts', () => {
    const summary = buildSummary({
        branch: 'feature/x',
        prereleaseIdentifier: 'beta',
        baseRef: 'main',
        eventName: 'workflow_call',
        changedDirs: '',
        repository: 'org/repo',
        repositoryOwner: 'org',
        artifactsDir: '/nonexistent',
    });
    assert.ok(summary.includes('📦 Pre-release Packages Generated'));
    assert.ok(summary.includes('No packages were generated.'));
    assert.ok(summary.includes('📥 Installation'));
    assert.ok(summary.includes('org/index.json'));
});

test('buildSummary - with packages renders links and install commands', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'MyLib.1.2.3-alpha.nupkg'), '');
    const summary = buildSummary({
        branch: 'feature/x',
        prereleaseIdentifier: 'alpha',
        baseRef: 'main',
        eventName: 'push',
        changedDirs: '',
        repository: 'my-org/my-repo',
        repositoryOwner: 'my-org',
        artifactsDir: tmp,
    });
    assert.ok(summary.includes('MyLib.1.2.3-alpha.nupkg'));
    assert.ok(summary.includes('my-org/my-repo/pkgs/nuget/MyLib'));
    assert.ok(summary.includes('dotnet add package MyLib --version 1.2.3-alpha'));
    assert.ok(summary.includes('my-org/index.json'));
});

test('buildSummary - header contains branch, identifier, base-ref and event', () => {
    const summary = buildSummary({
        branch: 'my-branch',
        prereleaseIdentifier: 'rc',
        baseRef: 'develop',
        eventName: 'push',
        changedDirs: '',
        repository: 'org/repo',
        repositoryOwner: 'org',
        artifactsDir: '/nonexistent',
    });
    assert.ok(summary.includes('`my-branch`'));
    assert.ok(summary.includes('`rc`'));
    assert.ok(summary.includes('`develop`'));
    assert.ok(summary.includes('push'));
});

test('buildSummary - multiple packages each get their own entry', () => {
    const tmp = makeTmpDir();
    fs.writeFileSync(path.join(tmp, 'Alpha.1.0.0-beta.nupkg'), '');
    fs.writeFileSync(path.join(tmp, 'Beta.2.0.0-beta.nupkg'), '');
    const summary = buildSummary({
        branch: 'main',
        prereleaseIdentifier: 'beta',
        baseRef: 'main',
        eventName: 'push',
        changedDirs: '',
        repository: 'org/repo',
        repositoryOwner: 'org',
        artifactsDir: tmp,
    });
    assert.ok(summary.includes('Alpha.1.0.0-beta.nupkg'));
    assert.ok(summary.includes('Beta.2.0.0-beta.nupkg'));
    assert.ok(summary.includes('dotnet add package Alpha --version 1.0.0-beta'));
    assert.ok(summary.includes('dotnet add package Beta --version 2.0.0-beta'));
});

// --- run() ---

test('run - exits 1 when GITHUB_STEP_SUMMARY is not set', () => {
    const r = withEnv({
        GITHUB_STEP_SUMMARY: '',
        INPUT_PRERELEASE_IDENTIFIER: 'alpha',
        INPUT_BASE_REF: 'main',
        GITHUB_REF_NAME: 'main',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_REPOSITORY_OWNER: 'org',
    }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.ok(r.err.includes('GITHUB_STEP_SUMMARY'));
});

test('run - writes summary to GITHUB_STEP_SUMMARY file', () => {
    const tmp = makeTmpDir();
    const summaryFile = makeSummaryFile(tmp);
    const r = withEnv({
        GITHUB_STEP_SUMMARY: summaryFile,
        INPUT_PRERELEASE_IDENTIFIER: 'alpha',
        INPUT_BASE_REF: 'main',
        INPUT_CHANGED_DIRS: '[]',
        INPUT_ARTIFACTS_DIR: '/nonexistent',
        GITHUB_REF_NAME: 'feature/test',
        GITHUB_EVENT_NAME: 'workflow_call',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_REPOSITORY_OWNER: 'org',
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    const content = fs.readFileSync(summaryFile, 'utf8');
    assert.ok(content.includes('Pre-Release Build Summary'));
    assert.ok(content.includes('No libraries with changes detected'));
});

test('run - appends to existing summary file', () => {
    const tmp = makeTmpDir();
    const summaryFile = path.join(tmp, 'summary.md');
    fs.writeFileSync(summaryFile, '# Existing Content\n');
    withEnv({
        GITHUB_STEP_SUMMARY: summaryFile,
        INPUT_PRERELEASE_IDENTIFIER: 'alpha',
        INPUT_BASE_REF: 'main',
        INPUT_CHANGED_DIRS: '[]',
        INPUT_ARTIFACTS_DIR: '/nonexistent',
        GITHUB_REF_NAME: 'main',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_REPOSITORY_OWNER: 'org',
    }, () => run());
    const content = fs.readFileSync(summaryFile, 'utf8');
    assert.ok(content.startsWith('# Existing Content'));
    assert.ok(content.includes('Pre-Release Build Summary'));
});

test('run - debug mode logs 🔍 prefixed lines', () => {
    const tmp = makeTmpDir();
    const summaryFile = makeSummaryFile(tmp);
    const r = withEnv({
        GITHUB_STEP_SUMMARY: summaryFile,
        INPUT_PRERELEASE_IDENTIFIER: 'beta',
        INPUT_BASE_REF: 'main',
        INPUT_CHANGED_DIRS: '',
        INPUT_ARTIFACTS_DIR: '/nonexistent',
        INPUT_DEBUG_MODE: 'true',
        GITHUB_REF_NAME: 'main',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_REPOSITORY_OWNER: 'org',
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    assert.ok(r.out.includes('🔍'));
});

test('run - no debug output when debug-mode is false', () => {
    const tmp = makeTmpDir();
    const summaryFile = makeSummaryFile(tmp);
    const r = withEnv({
        GITHUB_STEP_SUMMARY: summaryFile,
        INPUT_PRERELEASE_IDENTIFIER: 'alpha',
        INPUT_BASE_REF: 'main',
        INPUT_CHANGED_DIRS: '[]',
        INPUT_ARTIFACTS_DIR: '/nonexistent',
        INPUT_DEBUG_MODE: 'false',
        GITHUB_REF_NAME: 'main',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_REPOSITORY: 'org/repo',
        GITHUB_REPOSITORY_OWNER: 'org',
    }, () => run());
    assert.strictEqual(r.exitCode, 0);
    assert.ok(!r.out.includes('🔍'));
});
