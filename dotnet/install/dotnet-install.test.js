const test = require('node:test');
const assert = require('node:assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, parseVersions } = require('./dotnet-install');

function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    try {
        return fn();
    } finally {
        process.env = prev;
    }
}

function captureExit(fn) {
    const origExit = process.exit;
    let code;
    process.exit = c => {
        code = c || 0;
        throw new Error(`__EXIT_${code}__`);
    };
    try {
        fn();
    } catch (error) {
        if (!/^__EXIT_/.test(error.message)) {
            throw error;
        }
    } finally {
        process.exit = origExit;
    }
    return code;
}

function createOutputFile() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-'));
    const ghOutput = path.join(tmp, 'out');
    fs.writeFileSync(ghOutput, '');
    return { tmp, ghOutput };
}

test('parseVersions trims values and skips blanks', () => {
    assert.deepStrictEqual(parseVersions(' 8.0.x, , 10.0.x , '), ['8.0.x', '10.0.x']);
});

test('parseVersions returns an empty array for falsy input', () => {
    assert.deepStrictEqual(parseVersions(''), []);
    assert.deepStrictEqual(parseVersions(undefined), []);
});

test('errors when INPUT_DOTNET_VERSION missing', () => {
    const { ghOutput } = createOutputFile();
    const code = captureExit(() => withEnv({ GITHUB_OUTPUT: ghOutput }, () => run()));
    assert.strictEqual(code, 1);
});

test('writes parsed versions to GITHUB_OUTPUT', () => {
    const { ghOutput } = createOutputFile();

    withEnv({ INPUT_DOTNET_VERSION: '8.0.x,10.0.x', GITHUB_OUTPUT: ghOutput }, () => run());

    const content = fs.readFileSync(ghOutput, 'utf8');
    assert.match(content, /version_count=2/);
    assert.match(content, /version_1=8\.0\.x/);
    assert.match(content, /version_2=10\.0\.x/);
});

test('runs as a CLI and writes parsed versions to GITHUB_OUTPUT', () => {
    const { ghOutput } = createOutputFile();
    childProcess.execFileSync(process.execPath, [path.join(__dirname, 'dotnet-install.js')], {
        env: {
            ...process.env,
            INPUT_DOTNET_VERSION: '6.0.x,7.0.x,8.0.x',
            GITHUB_OUTPUT: ghOutput,
        },
        stdio: 'pipe',
    });

    const content = fs.readFileSync(ghOutput, 'utf8');
    assert.match(content, /version_count=3/);
    assert.match(content, /version_1=6\.0\.x/);
    assert.match(content, /version_2=7\.0\.x/);
    assert.match(content, /version_3=8\.0\.x/);
});

test('errors when no versions parsed', () => {
    const { ghOutput } = createOutputFile();
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '  ,  , ', GITHUB_OUTPUT: ghOutput }, () => run()));
    assert.strictEqual(code, 1);
});

test('errors when more than five versions are provided', () => {
    const { ghOutput } = createOutputFile();
    const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '1,2,3,4,5,6', GITHUB_OUTPUT: ghOutput }, () => run()));
    assert.strictEqual(code, 1);
});

test('errors when GITHUB_OUTPUT is not set', () => {
    const savedOutput = process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_OUTPUT;
    try {
        const code = captureExit(() => withEnv({ INPUT_DOTNET_VERSION: '8.0.x' }, () => run()));
        assert.strictEqual(code, 1);
    } finally {
        if (savedOutput !== undefined) {
            process.env.GITHUB_OUTPUT = savedOutput;
        }
    }
});