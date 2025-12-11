const test = require('node:test');
const assert = require('node:assert');
const { resolveTarget, main } = require('./resolve-target');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('prefers project when both project and solution are found', () => {
    const result = resolveTarget({
        PREFER_SOLUTION: 'false',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assert.strictEqual(result, 'src/demo/dotnet/src/Api/Api.csproj');
});

test('prefers solution when preferSolution is true', () => {
    const result = resolveTarget({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assert.strictEqual(result, 'src/demo/dotnet/demo.sln');
});

test('falls back to project when solution missing', () => {
    const result = resolveTarget({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: '',
    });
    assert.strictEqual(result, 'src/demo/dotnet/src/Api/Api.csproj');
});

test('falls back to solution when preferSolution false and project missing', () => {
    const result = resolveTarget({
        PREFER_SOLUTION: 'false',
        PROJECT_FOUND: '',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assert.strictEqual(result, 'src/demo/dotnet/demo.sln');
});

test('project-file input wins', () => {
    const result = resolveTarget({
        PROJECT_FILE: 'custom.csproj',
        PROJECT_FOUND: 'ignored.csproj',
        SOLUTION_FOUND: 'demo.sln',
    });
    assert.strictEqual(result, 'custom.csproj');
});

test('errors when no target found', () => {
    assert.throws(() => resolveTarget({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: '',
        SOLUTION_FOUND: '',
    }), /No project or solution discovered/);
});

function runMainWith(env) {
    const prevEnv = { ...process.env };
    const output = { stdout: '', stderr: '' };
    const so = process.stdout.write;
    const se = process.stderr.write;
    let exitCode = 0;
    const origExit = process.exit;

    process.exit = code => { exitCode = code || 0; throw new Error(`__EXIT_${exitCode}__`); };
    process.stdout.write = (chunk, encoding, callback) => { output.stdout += chunk; return so.call(process.stdout, chunk, encoding, callback); };
    process.stderr.write = (chunk, encoding, callback) => { output.stderr += chunk; return se.call(process.stderr, chunk, encoding, callback); };

    try {
        main(env);
    } catch (err) {
        if (!/^__EXIT_/.test(err.message)) {
            throw err;
        }
    } finally {
        process.env = prevEnv;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }

    return { exitCode, output };
}

test('main writes resolved path to GITHUB_OUTPUT', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-target-'));
    const outputFile = path.join(tempDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        GITHUB_OUTPUT: outputFile,
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
        PREFER_SOLUTION: 'false'
    };

    const result = runMainWith(env);
    assert.strictEqual(result.exitCode, 0);

    const contents = fs.readFileSync(outputFile, 'utf8');
    assert.ok(contents.includes('path=src/demo/dotnet/src/Api/Api.csproj'));
});

test('main errors when GITHUB_OUTPUT missing', () => {
    const env = {
        GITHUB_OUTPUT: '',
        PROJECT_FOUND: 'src/demo/dotnet/demo.sln',
        SOLUTION_FOUND: ''
    };

    const result = runMainWith(env);
    assert.strictEqual(result.exitCode, 1);
    assert.match(result.output.stderr, /GITHUB_OUTPUT not set/);
});
