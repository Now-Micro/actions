const test = require('node:test');
const assert = require('node:assert');
const { configureSources } = require('./configure-sources');

function makeListOutput(names) {
    const lines = ['Registered Sources:'];
    names.forEach((name, index) => {
        lines.push(`  ${index + 1}.  ${name}`);
    });
    return lines.join('\n');
}

function createExecStub(listOutput) {
    const calls = [];
    return {
        exec: (cmd, args, opts = {}) => {
            calls.push({ cmd, args, opts });
            if (args[0] === 'nuget' && args[1] === 'list') {
                return listOutput;
            }
            return '';
        },
        calls,
    };
}

test('skips when there are no sources to configure', () => {
    const logs = [];
    const env = {
        INPUT_NAMES: '',
        INPUT_USERNAMES: '',
        INPUT_PASSWORDS: '',
        INPUT_URLS: '',
    };
    const entries = configureSources(env, {
        log: message => logs.push(message),
        exec: () => {
            throw new Error('dotnet should not be executed when there are no sources');
        },
    });

    assert.strictEqual(entries.length, 0);
    assert.deepStrictEqual(logs, ['No NuGet sources to configure; skipping.']);
});

test('adds a source when the name is not yet registered', () => {
    const execStub = createExecStub(makeListOutput(['Existing']));
    const env = {
        INPUT_NAMES: 'CodeBits',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/owner/index.json',
    };
    const entries = configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.strictEqual(entries.length, 1);
    assert.deepStrictEqual(execStub.calls, [
        {
            cmd: 'dotnet',
            args: ['nuget', 'list', 'source'],
            opts: { encoding: 'utf8' },
        },
        {
            cmd: 'dotnet',
            args: [
                'nuget',
                'add',
                'source',
                '--username',
                'user',
                '--password',
                'pass',
                '--store-password-in-clear-text',
                '--name',
                'CodeBits',
                'https://nuget.pkg.github.com/owner/index.json',
            ],
            opts: { encoding: 'utf8' },
        },
    ]);
});

test('updates a source when the name already exists', () => {
    const execStub = createExecStub(makeListOutput(['CodeBits']));
    const env = {
        INPUT_NAMES: 'CodeBits',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/owner/index.json',
    };
    const entries = configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.strictEqual(entries.length, 1);
    assert.deepStrictEqual(execStub.calls, [
        {
            cmd: 'dotnet',
            args: ['nuget', 'list', 'source'],
            opts: { encoding: 'utf8' },
        },
        {
            cmd: 'dotnet',
            args: [
                'nuget',
                'update',
                'source',
                'CodeBits',
                '--username',
                'user',
                '--password',
                'pass',
                '--store-password-in-clear-text',
            ],
            opts: { encoding: 'utf8' },
        },
    ]);
});

test('multiple entries keep order and skip empty names', () => {
    const execStub = createExecStub(makeListOutput(['CodeBits']));
    const env = {
        INPUT_NAMES: 'Primary,,Backup',
        INPUT_USERNAMES: 'puser,buser,xuser',
        INPUT_PASSWORDS: 'ppass,bpass,xpass',
        INPUT_URLS: 'https://primary/,https://backup/,https://extra/',
    };
    const entries = configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries.map(e => e.name), ['Primary', 'Backup']);
    assert.strictEqual(execStub.calls.length, 4); // two list/add pairs
});

test('debug mode logs dotnet output', () => {
    const execStub = createExecStub(makeListOutput(['Primary']));
    const logs = [];
    const env = {
        INPUT_NAMES: 'Primary',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://primary/',
        INPUT_DEGUG_MODE: 'true',
    };

    configureSources(env, {
        exec: execStub.exec,
        log: message => logs.push(message),
    });

    assert.ok(logs.some(line => line.includes('dotnet nuget list source output:')));
    assert.ok(logs.some(line => line.includes('Registered Sources:')));
});

test('special characters in name are escaped when matching', () => {
    const execStub = createExecStub(makeListOutput(['My.Source+Name']));
    const env = {
        INPUT_NAMES: 'My.Source+Name',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://source/',
    };

    configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.ok(execStub.calls.some(call => call.args[1] === 'update'));
});

test('matches existing source regardless of casing', () => {
    const execStub = createExecStub(makeListOutput(['CodeBits']));
    const env = {
        INPUT_NAMES: 'codebIts',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/Now-Micro/index.json',
    };

    configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.ok(execStub.calls.some(call => call.args[1] === 'update'));
});