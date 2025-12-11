const test = require('node:test');
const assert = require('node:assert');
const { validateInputs, main } = require('./validate-inputs');

test('validateInputs prefers the explicit project-file input', () => {
    const result = validateInputs({ PROJECT_FILE: '    api.csproj ' });
    assert.strictEqual(result.status, 'project');
    assert.strictEqual(result.message, 'project-file provided: validation passed');
});

test('validateInputs accepts a directory when project-file is empty', () => {
    const result = validateInputs({ DIRECTORY: '  src/Project ' });
    assert.strictEqual(result.status, 'directory');
    assert.strictEqual(result.message, 'directory provided: validation passed');
});

test('validateInputs errors when neither project-file nor directory provided', () => {
    const result = validateInputs({ PROJECT_FILE: '', DIRECTORY: '   ' });
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.message, "Error: Provide 'project-file' or 'directory' and an optional 'project-regex'.");
});

test('main logs success and does not exit when validation passes', () => {
    const logs = [];
    const logger = {
        log: message => logs.push({ level: 'log', message }),
        error: () => logs.push({ level: 'error', message: '' }),
    };
    const exitCalls = [];
    main({ PROJECT_FILE: 'project.csproj' }, { logger, exit: code => exitCalls.push(code) });

    assert.strictEqual(exitCalls.length, 0);
    assert.deepStrictEqual(logs, [
        { level: 'log', message: 'project-file provided: validation passed' },
    ]);
});

test('main logs error and exits when validation fails', () => {
    const logs = [];
    const logger = {
        log: message => logs.push({ level: 'log', message }),
        error: message => logs.push({ level: 'error', message }),
    };
    const exitCalls = [];

    main({ PROJECT_FILE: '', DIRECTORY: '' }, { logger, exit: code => exitCalls.push(code) });

    assert.strictEqual(exitCalls.length, 1);
    assert.strictEqual(exitCalls[0], 1);
    assert.deepStrictEqual(logs, [
        { level: 'error', message: "Error: Provide 'project-file' or 'directory' and an optional 'project-regex'." },
    ]);
});
