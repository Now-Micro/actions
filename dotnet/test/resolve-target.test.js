const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'resolve-target.js');

function runWith(envOverrides = {}) {
    const env = { ...process.env, ...envOverrides };
    return spawnSync(process.execPath, [scriptPath], {
        env,
        encoding: 'utf8',
    });
}

function assertPath(result, expected) {
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, new RegExp(`path=${expected}`));
}

test('prefers project when both project and solution are found', () => {
    const result = runWith({
        PREFER_SOLUTION: 'false',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assertPath(result, 'src/demo/dotnet/src/Api/Api.csproj');
});

test('prefers solution when preferSolution is true', () => {
    const result = runWith({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assertPath(result, 'src/demo/dotnet/demo.sln');
});

test('falls back to project when solution missing', () => {
    const result = runWith({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: 'src/demo/dotnet/src/Api/Api.csproj',
        SOLUTION_FOUND: '',
    });
    assertPath(result, 'src/demo/dotnet/src/Api/Api.csproj');
});

test('falls back to solution when preferSolution false and project missing', () => {
    const result = runWith({
        PREFER_SOLUTION: 'false',
        PROJECT_FOUND: '',
        SOLUTION_FOUND: 'src/demo/dotnet/demo.sln',
    });
    assertPath(result, 'src/demo/dotnet/demo.sln');
});

test('project-file input wins', () => {
    const result = runWith({
        PROJECT_FILE: 'custom.csproj',
        PROJECT_FOUND: 'ignored.csproj',
        SOLUTION_FOUND: 'demo.sln',
    });
    assertPath(result, 'custom.csproj');
});

test('errors when no target found', () => {
    const result = runWith({
        PREFER_SOLUTION: 'true',
        PROJECT_FOUND: '',
        SOLUTION_FOUND: '',
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /No project or solution discovered/);
});
