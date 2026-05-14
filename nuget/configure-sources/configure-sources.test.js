const test = require('node:test');
const assert = require('node:assert');
const { configureSources, run, parseRegisteredSources } = require('./configure-sources');

function makeListOutput(entries) {
    const lines = ['Registered Sources:'];
    entries.forEach((entry, index) => {
        const activeEntry = typeof entry === 'string'
            ? { name: entry, url: `https://example.invalid/${entry}/index.json` }
            : entry;
        lines.push(`  ${index + 1}.  ${activeEntry.name} [Enabled]`);
        lines.push(`      ${activeEntry.url}`);
    });
    return lines.join('\n');
}

function createExecStub(listOutput, options = {}) {
    const calls = [];
    return {
        exec: (cmd, args, opts = {}) => {
            calls.push({ cmd, args, opts });
            if (options.shouldThrow && options.shouldThrow(args)) {
                throw options.throwError || new Error('dotnet failed');
            }
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
                '--source',
                'https://nuget.pkg.github.com/owner/index.json',
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
    assert.deepStrictEqual(entries.map(entry => entry.username), ['puser', 'xuser']);
    assert.deepStrictEqual(entries.map(entry => entry.password), ['ppass', 'xpass']);
    assert.deepStrictEqual(entries.map(entry => entry.url), ['https://primary/', 'https://extra/']);
    assert.strictEqual(execStub.calls.length, 4); // two list/add pairs
});

test('single credentials are broadcast across multiple urls', () => {
    const execStub = createExecStub(makeListOutput([]));
    const env = {
        INPUT_NAMES: 'Primary,Backup',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://primary/,https://backup/',
    };

    const entries = configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.strictEqual(entries.length, 2);
    assert.deepStrictEqual(entries.map(entry => entry.username), ['user', 'user']);
    assert.deepStrictEqual(entries.map(entry => entry.password), ['pass', 'pass']);
    assert.deepStrictEqual(entries.map(entry => entry.url), ['https://primary/', 'https://backup/']);
    assert.strictEqual(execStub.calls.length, 4);
});

test('debug mode logs dotnet output', () => {
    const execStub = createExecStub(makeListOutput(['Primary']));
    const logs = [];
    const env = {
        INPUT_NAMES: 'Primary',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://primary/',
        INPUT_DEBUG_MODE: 'true',
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

test('parses source entries with disabled status and blank lines before urls', () => {
    const parsed = parseRegisteredSources([
        'Registered Sources:',
        '  1.  Foo [Disabled]',
        '',
        '      https://example.invalid/foo/index.json',
        '  2.  Bar [Enabled]',
        '      https://example.invalid/bar/index.json',
    ].join('\n'));

    assert.deepStrictEqual(parsed, [
        { name: 'Foo', url: 'https://example.invalid/foo/index.json' },
        { name: 'Bar', url: 'https://example.invalid/bar/index.json' },
    ]);
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

test('renames existing source when url matches but name differs', () => {
    const execStub = createExecStub(makeListOutput([
        { name: 'CodeBits', url: 'https://nuget.pkg.github.com/Now-Micro/index.json' },
    ]));
    const env = {
        INPUT_NAMES: 'Now-Micro',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/Now-Micro/index.json',
    };

    configureSources(env, {
        exec: execStub.exec,
        log: () => { },
    });

    assert.ok(execStub.calls.some(call => call.args[0] === 'nuget' && call.args[1] === 'remove' && call.args.includes('CodeBits')),
        'expected remove to be called for the old name');
    assert.ok(execStub.calls.some(call => call.args.includes('--name') && call.args.includes('Now-Micro')),
        'expected add command to include the new name');
});

test('run logs errors and exits when configureSources throws', () => {
    const env = {
        INPUT_NAMES: 'CodeBits',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/owner/index.json',
    };
    const execStub = () => { throw new Error('boom'); };
    const errors = [];
    const exitCodes = [];
    run(env, {
        exec: execStub,
        log: () => { },
        error: message => errors.push(message),
        exit: code => exitCodes.push(code),
    });

    assert.ok(errors.length >= 1);
    assert.deepStrictEqual(exitCodes, [1]);
});

test('duplicate source add failures retry as an update', () => {
    const calls = [];
    const exec = (cmd, args, opts = {}) => {
        calls.push({ cmd, args, opts });
        if (args[0] === 'nuget' && args[1] === 'list') {
            return makeListOutput([]);
        }
        if (args[0] === 'nuget' && args[1] === 'add') {
            const error = new Error('Command failed: dotnet nuget add source');
            error.stdout = '';
            error.stderr = "A source with the name 'Now-Micro' already exists.";
            throw error;
        }
        return '';
    };

    const env = {
        INPUT_NAMES: 'Now-Micro',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/Now-Micro/index.json',
    };

    const logs = [];
    const entries = configureSources(env, {
        exec,
        log: message => logs.push(message),
    });

    assert.strictEqual(entries.length, 1);
    assert.ok(logs.some(line => line.includes('Retrying as an update')));
    assert.ok(calls.some(call => call.args[1] === 'update'), 'expected fallback update command to run');
});

test('parseRegisteredSources skips entries without urls', () => {
    const lines = ['Registered Sources:', '  1.  Foo [Enabled]', '      ', '  2.  Bar [Enabled]', '      https://example.com'];
    const parsed = parseRegisteredSources(lines.join('\n'));
    assert.deepStrictEqual(parsed, [
        { name: 'Foo', url: '' },
        { name: 'Bar', url: 'https://example.com' },
    ]);
});

test('default logger is used when no log override supplied', () => {
    const execStub = createExecStub(makeListOutput(['Default']));
    const env = {
        INPUT_NAMES: 'Default',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://default/',
    };
    const writes = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk, ...rest) => {
        writes.push(String(chunk));
        return true;
    };
    try {
        configureSources(env, {
            exec: execStub.exec,
        });
    } finally {
        process.stdout.write = originalWrite;
    }

    assert.ok(writes.some(line => line.includes('Configuring 1 NuGet source(s)...')),
        'expected default logger to emit configuration log');
});

test('run uses default error logger when configureSources throws', () => {
    const env = {
        INPUT_NAMES: 'CodeBits',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/owner/index.json',
    };
    const exitCodes = [];
    const errors = [];
    const originalStderr = process.stderr.write;
    process.stderr.write = (chunk, ...rest) => {
        errors.push(String(chunk));
        return true;
    };
    try {
        run(env, {
            exec: () => {
                throw new Error('boom');
            },
            exit: code => exitCodes.push(code),
        });
    } finally {
        process.stderr.write = originalStderr;
    }

    assert.deepStrictEqual(exitCodes, [1]);
    assert.ok(errors.some(line => line.includes('dotnet nuget list source failed')),
        'expected default error logger to emit the wrapped dotnet command failure');
    assert.ok(errors.some(line => line.includes('message: boom')),
        'expected default error logger to include the underlying exec error message');
});

test('run includes dotnet stderr when a command fails', () => {
    const env = {
        INPUT_NAMES: 'CodeBits',
        INPUT_USERNAMES: 'user',
        INPUT_PASSWORDS: 'pass',
        INPUT_URLS: 'https://nuget.pkg.github.com/owner/index.json',
    };
    const exitCodes = [];
    const errors = [];
    const originalStderr = process.stderr.write;
    process.stderr.write = (chunk, ...rest) => {
        errors.push(String(chunk));
        return true;
    };
    try {
        run(env, {
            exec: (cmd, args) => {
                if (args[0] === 'nuget' && args[1] === 'list') {
                    return makeListOutput([]);
                }
                const error = new Error('Command failed');
                error.stderr = 'A source with the name already exists.';
                throw error;
            },
            exit: code => exitCodes.push(code),
        });
    } finally {
        process.stderr.write = originalStderr;
    }

    assert.deepStrictEqual(exitCodes, [1]);
    assert.ok(errors.some(line => line.includes('A source with the name already exists.')),
        'expected default error logger to include the underlying dotnet stderr');
});