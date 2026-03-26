const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('./validate-release');

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

function makeTempDir(prefix = 'validate-release-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function runWith(env = {}) {
    const outFile = path.join(makeTempDir('validate-release-out-'), 'out.txt');
    fs.writeFileSync(outFile, '');
    const r = withEnv({ ...env, GITHUB_OUTPUT: outFile }, () => run());
    r.outputContent = fs.readFileSync(outFile, 'utf8');
    return r;
}

function createProject(root, relativeFile) {
    const full = path.join(root, relativeFile);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '<Project />');
    return full;
}

test('manual inputs resolve a single project directory', () => {
    const root = makeTempDir();
    const project = createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const expectedDir = path.dirname(project).split(path.sep).join('/');
    const r = runWith({
        INPUT_PACKAGE: 'Api',
        INPUT_VERSION: '1.2.3',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=1.2.3/);
    assert.match(r.outputContent, /library_name=Api/);
    assert.ok(r.outputContent.includes(`path_to_project=${expectedDir}`));
});

test('ref-name fallback resolves a project directory', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'FromRef', 'FromRef.csproj'));
    const r = runWith({
        INPUT_REF_NAME: 'release/FromRef/2.3.4',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=2.3.4/);
    assert.match(r.outputContent, /library_name=FromRef/);
    assert.match(r.outputContent, /path_to_project=.*\/src\/FromRef/);
});

test('GITHUB_REF_NAME is used when INPUT_REF_NAME is absent', () => {
    const root = makeTempDir();
    createProject(root, path.join('Project', 'Project.csproj'));
    const r = runWith({
        GITHUB_REF_NAME: 'release/Project/3.4.5',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=3.4.5/);
    assert.match(r.outputContent, /library_name=Project/);
});

test('manual inputs take priority over ref-name', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'CliPkg', 'CliPkg.csproj'));
    const r = runWith({
        INPUT_PACKAGE: 'CliPkg',
        INPUT_VERSION: '9.9.9',
        INPUT_REF_NAME: 'release/Other/1.0.0',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.outputContent, /version=9.9.9/);
    assert.match(r.outputContent, /library_name=CliPkg/);
    assert.ok(!/Other/.test(r.outputContent));
});

test('invalid manual semantic version exits 1', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const r = runWith({
        INPUT_PACKAGE: 'Api',
        INPUT_VERSION: '1.2',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid semantic version/);
});

test('invalid ref-name semantic version exits 1', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const r = runWith({
        INPUT_REF_NAME: 'release/Api/1.2',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid semantic version/);
});

test('missing inputs and non-release ref exits 1', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const r = runWith({
        INPUT_REF_NAME: 'main',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Ref does not match release\/\* and package\/version inputs are missing or incomplete/);
});

test('no project found exits 1', () => {
    const root = makeTempDir();
    const r = runWith({
        INPUT_PACKAGE: 'Missing',
        INPUT_VERSION: '1.0.0',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /No project found for package Missing/);
});

test('multiple project matches exits 1', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    createProject(root, path.join('tests', 'Api', 'Api.csproj'));
    const r = runWith({
        INPUT_PACKAGE: 'Api',
        INPUT_VERSION: '1.0.0',
        INPUT_WORKING_DIRECTORY: root,
    });

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Multiple projects found for package Api/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const r = withEnv({
        INPUT_PACKAGE: 'Api',
        INPUT_VERSION: '1.0.0',
        INPUT_WORKING_DIRECTORY: root,
        GITHUB_OUTPUT: '',
    }, () => run());

    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /GITHUB_OUTPUT not set/);
});

test('debug mode logs parsed configuration and path', () => {
    const root = makeTempDir();
    createProject(root, path.join('src', 'Api', 'Api.csproj'));
    const r = runWith({
        INPUT_PACKAGE: 'Api',
        INPUT_VERSION: '1.2.3',
        INPUT_WORKING_DIRECTORY: root,
        INPUT_DEBUG_MODE: 'true',
    });

    assert.strictEqual(r.exitCode, 0);
    assert.match(r.out, /Debug mode is ON/);
    assert.match(r.out, /Parsed release configuration from manual inputs/);
    assert.match(r.out, /path_to_project:/);
});