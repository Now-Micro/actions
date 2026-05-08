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

function writeUsers(dir, obj) {
    const file = path.join(dir, 'users.json');
    fs.writeFileSync(file, JSON.stringify(obj));
    return file;
}

function runWith(env) {
    const tmpDir = makeTempDir();
    const r = withEnv(env, () => run());
    r.tmpDir = tmpDir;
    return r;
}

const BASE_PERMISSIONS = {
    'CodeBits': {
        'release.yml': ['Beschuetzer', 'Test123']
    },
    'WarrantyService': {
        'release.yml': ['Test123']
    }
};

const BASE_USERS = {
    'Adam Major': 'Beschuetzer',
    'Test User': 'Test123',
    'Nick Huey': 'nlhuey',
    'Brian Ulrich': 'brian-trafera'
};

const VALID_WORKFLOW_REF = 'Now-Micro/CodeBits/.github/workflows/release.yml@refs/heads/main';
const VALID_REPOSITORY = 'Now-Micro/CodeBits';
const VALID_ACTOR = 'Beschuetzer';

function makeActionDir(permissions, users = BASE_USERS) {
    const tmpDir = makeTempDir();
    const actionDir = path.join(tmpDir, 'authorize');
    fs.mkdirSync(actionDir, { recursive: true });
    if (users !== null) {
        writeUsers(actionDir, users);
    }
    if (permissions) writePermissions(actionDir, permissions);
    return { tmpDir, actionDir };
}

function makeEnv(overrides = {}) {
    const { actionDir } = makeActionDir(BASE_PERMISSIONS);
    return {
        INPUT_ACTOR: VALID_ACTOR,
        INPUT_REPOSITORY: VALID_REPOSITORY,
        INPUT_WORKFLOW_REF: VALID_WORKFLOW_REF,
        GITHUB_ACTION_PATH: actionDir,
        ...overrides
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('authorized actor exits 0 and logs success', () => {
    const r = runWith(makeEnv());
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('invalid debug mode falls back to default logging', () => {
    const r = runWith(makeEnv({ INPUT_DEBUG_MODE: 'maybe' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /🔍 Checking authorization/);
});

test('second authorized actor in same repo is also permitted', () => {
    const r = runWith(makeEnv({ INPUT_ACTOR: 'Test123' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /✅.*Test123.*is authorized/);
});

test('permission entry can resolve through users.json aliases', () => {
    const { actionDir } = makeActionDir({
        'CodeBits': {
            'release.yml': ['Adam Major']
        }
    });

    const r = runWith(makeEnv({
        INPUT_ACTOR: 'Beschuetzer',
        GITHUB_ACTION_PATH: actionDir
    }));

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Users file:/);
    assert.match(r.out, /Actor alias resolved: 'Beschuetzer' → 'Adam Major'/);
    assert.match(r.out, /Authorization resolved via alias: Adam Major → Beschuetzer/);
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('missing users file still allows direct permission matches', () => {
    const { actionDir } = makeActionDir(BASE_PERMISSIONS, null);
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Users file not found/);
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('empty users file still allows direct permission matches', () => {
    const { actionDir } = makeActionDir(BASE_PERMISSIONS, null);
    fs.writeFileSync(path.join(actionDir, 'users.json'), '   \n');
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Users file is empty/);
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('unauthorized actor exits 1 with helpful message', () => {
    const r = runWith(makeEnv({ INPUT_ACTOR: 'UnknownUser' }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /UnknownUser/);
    assert.match(r.err, /not authorized/);
    assert.match(r.err, /Allowed actors:/);
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
    const { actionDir } = makeActionDir(null); // no authorize/permissions.json written
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Permissions file not found/);
});

test('malformed permissions JSON exits 1', () => {
    const { actionDir } = makeActionDir(null);
    fs.writeFileSync(path.join(actionDir, 'permissions.json'), '{ this is not json }');
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Failed to parse permissions or users file/);
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

test('authorization succeeds without GITHUB_OUTPUT', () => {
    const r = runWith(makeEnv());
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /✅.*is authorized/);
});

test('workflow ref with branch ref suffix is parsed correctly', () => {
    const r = runWith(makeEnv({
        INPUT_WORKFLOW_REF: 'Now-Micro/CodeBits/.github/workflows/release.yml@refs/tags/v1.2.3'
    }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /✅.*is authorized/);
});

test('permissions with empty actor list exits 1', () => {
    const { actionDir } = makeActionDir({ 'CodeBits': { 'release.yml': [] } });
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not authorized/);
});

test('non-array allowedActors exits 1 with (none) in message', () => {
    const { actionDir } = makeActionDir({
        'CodeBits': { 'release.yml': 'Beschuetzer' } // string, not array
    });
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /not authorized/);
    assert.match(r.err, /\(none\)/);
});

test('actor lookup is case-insensitive', () => {
    const r = runWith(makeEnv({ INPUT_ACTOR: 'beschuetzer' })); // lowercase
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /✅.*beschuetzer.*is authorized/);
});

test('repository lookup is case-insensitive', () => {
    const r = runWith(makeEnv({
        INPUT_REPOSITORY: 'Now-Micro/CODEBITS',
        INPUT_WORKFLOW_REF: 'Now-Micro/CODEBITS/.github/workflows/release.yml@refs/heads/main'
    }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /🔍 Repository:\s+Now-Micro\/CODEBITS\s+→\s+CODEBITS/);
});

test('workflow filename lookup is case-insensitive', () => {
    const r = runWith(makeEnv({
        INPUT_WORKFLOW_REF: 'Now-Micro/CodeBits/.github/workflows/RELEASE.YML@refs/heads/main'
    }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /🔍 Workflow ref:\s+Now-Micro\/CodeBits\/\.github\/workflows\/RELEASE\.YML@refs\/heads\/main\s+→\s+RELEASE\.YML/);
});

test('malformed users file exits 1', () => {
    const { actionDir } = makeActionDir(BASE_PERMISSIONS, null);
    fs.writeFileSync(path.join(actionDir, 'users.json'), '[]');
    const r = runWith(makeEnv({ GITHUB_ACTION_PATH: actionDir }));
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err, /Failed to parse permissions or users file/);
    assert.match(r.err, /Expected/);
});

test('debug mode disabled suppresses 🔍 logs but still prints ✅', () => {
    const r = runWith(makeEnv({ INPUT_DEBUG_MODE: 'false' }));
    assert.strictEqual(r.exitCode, 0);
    assert.ok(!r.out.includes('🔍'), 'debug lines should not appear when debug mode is off');
    assert.match(r.out, /✅.*Beschuetzer.*is authorized/);
});

test('debug mode enabled prints 🔍 logs', () => {
    const r = runWith(makeEnv({ INPUT_DEBUG_MODE: 'true' }));
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /🔍 Checking authorization/);
    assert.match(r.out, /🔍 Actor:/);
    assert.match(r.out, /🔍 Repository:/);
    assert.match(r.out, /🔍 Workflow ref:/);
    assert.match(r.out, /🔍 Permissions:/);
});
