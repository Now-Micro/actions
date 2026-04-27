const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run } = require('./authorize');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'authorize-'));
}

function writePermissions(dir, obj) {
    const file = path.join(dir, 'permissions.json');
    fs.writeFileSync(file, JSON.stringify(obj));
    return file;
}

function runWith(env) {
    const tmpDir = makeTempDir();
    const tmpOut = path.join(tmpDir, 'github_output.txt');
    fs.writeFileSync(tmpOut, '');
    const r = withEnv({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
    r.outputContent = fs.readFileSync(tmpOut, 'utf8');
    r.tmpDir = tmpDir;
    return r;
}

const BASE_PERMISSIONS = {
    'release.yml': {
        'CodeBits': ['Beschuetzer', 'Test123'],
        'WarrantyService': ['Test123']
    }
};

const VALID_WORKFLOW_REF = 'Now-Micro/CodeBits/.github/workflows/release.yml@refs/heads/main';
const VALID_REPOSITORY = 'Now-Micro/CodeBits';
const VALID_ACTOR = 'Beschuetzer';

function makeEnv(overrides = {}) {
    const tmpDir = makeTempDir();
    const permFile = writePermissions(tmpDir, BASE_PERMISSIONS);
    return {
        INPUT_ACTOR: VALID_ACTOR,
        INPUT_REPOSITORY: VALID_REPOSITORY,
        INPUT_WORKFLOW_REF: VALID_WORKFLOW_REF,
        INPUT_PERMISSIONS_FILE: permFile,
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('authorized actor exits 0 and writes authorized=true', () => {
    const r = runWith(makeEnv());
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /authorized=true/);
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('second authorized actor in same repo is also permitted', () => {
    const r = runWith(makeEnv({ INPUT_ACTOR: 'Test123' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /authorized=true/);
});

test('unauthorized actor exits 1 with helpful message', () => {
    const r = runWith(makeEnv({ INPUT_ACTOR: 'UnknownUser' }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /UnknownUser/);
    assert.match(r.err, /not authorized/);
    assert.match(r.err, /Allowed actors:/);
    assert.strictEqual(r.outputContent.includes('authorized=true'), false);
});

test('actor authorized in one repo but not another exits 1', () => {
    // Beschuetzer is in CodeBits but not WarrantyService
    const r = runWith(makeEnv({
        INPUT_ACTOR: 'Beschuetzer',
        INPUT_REPOSITORY: 'Now-Micro/WarrantyService',
        INPUT_WORKFLOW_REF: 'Now-Micro/WarrantyService/.github/workflows/release.yml@refs/heads/main'
    }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not authorized/);
    assert.match(r.err, /Beschuetzer/);
});

test('workflow not in permissions exits 1 with helpful message', () => {
    const r = runWith(makeEnv({
        INPUT_WORKFLOW_REF: 'Now-Micro/CodeBits/.github/workflows/deploy.yml@refs/heads/main'
    }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /deploy\.yml/);
    assert.match(r.err, /No permissions defined for workflow/);
});

test('repository not in workflow permissions exits 1 with helpful message', () => {
    const r = runWith(makeEnv({ INPUT_REPOSITORY: 'Now-Micro/UnlistedRepo' }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /UnlistedRepo/);
    assert.match(r.err, /No permissions defined for repository/);
});

test('permissions file not found exits 1', () => {
    const r = runWith(makeEnv({ INPUT_PERMISSIONS_FILE: '/nonexistent/path/permissions.json' }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Permissions file not found/);
});

test('malformed permissions JSON exits 1', () => {
    const tmpDir = makeTempDir();
    const badFile = path.join(tmpDir, 'permissions.json');
    fs.writeFileSync(badFile, '{ this is not json }');
    const r = runWith(makeEnv({ INPUT_PERMISSIONS_FILE: badFile }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Failed to parse permissions file/);
});

test('missing INPUT_ACTOR exits 1', () => {
    const env = makeEnv();
    delete env.INPUT_ACTOR;
    const r = runWith(env);
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_ACTOR is required/);
});

test('missing INPUT_REPOSITORY exits 1', () => {
    const env = makeEnv();
    delete env.INPUT_REPOSITORY;
    const r = runWith(env);
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_REPOSITORY is required/);
});

test('missing INPUT_WORKFLOW_REF exits 1', () => {
    const env = makeEnv();
    delete env.INPUT_WORKFLOW_REF;
    const r = runWith(env);
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /INPUT_WORKFLOW_REF is required/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const env = makeEnv();
    const tmpDir = makeTempDir();
    // Run through withEnv directly to suppress the auto GITHUB_OUTPUT injection from runWith
    const r = withEnv({ ...env, GITHUB_OUTPUT: '' }, () => run());
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /GITHUB_OUTPUT is not set/);
});

test('workflow ref with branch ref suffix is parsed correctly', () => {
    const r = runWith(makeEnv({
        INPUT_WORKFLOW_REF: 'Now-Micro/CodeBits/.github/workflows/release.yml@refs/tags/v1.2.3'
    }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /authorized=true/);
});

test('permissions with empty actor list exits 1', () => {
    const tmpDir = makeTempDir();
    const permFile = writePermissions(tmpDir, {
        'release.yml': { 'CodeBits': [] }
    });
    const r = runWith(makeEnv({ INPUT_PERMISSIONS_FILE: permFile }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not authorized/);
});

test('uses GITHUB_ACTION_PATH default path when INPUT_PERMISSIONS_FILE not set', () => {
    // Simulate the composite action layout: GITHUB_ACTION_PATH/../../.github/permissions.json
    const tmpDir = makeTempDir();
    const actionDir = path.join(tmpDir, 'authorize');
    const githubDir = path.join(tmpDir, '.github');
    fs.mkdirSync(actionDir, { recursive: true });
    fs.mkdirSync(githubDir, { recursive: true });
    // path.join(GITHUB_ACTION_PATH, '..', '.github', 'permissions.json')
    // = path.join(actionDir, '..', '.github', 'permissions.json') = tmpDir/.github/permissions.json
    writePermissions(githubDir, BASE_PERMISSIONS);
    const env = makeEnv();
    delete env.INPUT_PERMISSIONS_FILE;
    const tmpOut = path.join(tmpDir, 'github_output.txt');
    fs.writeFileSync(tmpOut, '');
    const r = withEnv({ ...env, GITHUB_ACTION_PATH: actionDir, GITHUB_OUTPUT: tmpOut }, () => run());
    r.outputContent = fs.readFileSync(tmpOut, 'utf8');
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /authorized=true/);
});

test('non-array allowedActors exits 1 with (none) in message', () => {
    const tmpDir = makeTempDir();
    const permFile = writePermissions(tmpDir, {
        'release.yml': { 'CodeBits': 'Beschuetzer' } // string, not array
    });
    const r = runWith(makeEnv({ INPUT_PERMISSIONS_FILE: permFile }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not authorized/);
    assert.match(r.err, /\(none\)/);
});
