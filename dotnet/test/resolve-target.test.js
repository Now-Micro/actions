const test = require('node:test');
const assert = require('node:assert');
const { resolveTarget } = require('./resolve-target');

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
