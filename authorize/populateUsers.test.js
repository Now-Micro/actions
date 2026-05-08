const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('node:readline/promises');

const {
    buildUsersObject,
    findExistingNameForLogin,
    fetchMemberProfiles,
    fetchOrgMembers,
    loadExistingUsers,
    isYes,
    mergeAliases,
    normalizeWhitespace,
    promptForConfirmation,
    run,
    uniqueCaseInsensitive
} = require('./populateUsers');

async function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);

    let exitCode = 0;
    const origExit = process.exit;
    process.exit = code => {
        exitCode = code || 0;
        throw new Error(`__EXIT_${exitCode}__`);
    };

    let out = '';
    let err = '';
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = (chunk, encoding, cb) => {
        out += chunk;
        return so.call(process.stdout, chunk, encoding, cb);
    };
    process.stderr.write = (chunk, encoding, cb) => {
        err += chunk;
        return se.call(process.stderr, chunk, encoding, cb);
    };

    try {
        try {
            await fn();
        } catch (error) {
            if (!/^__EXIT_/.test(error.message)) {
                throw error;
            }
        }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }

    return { exitCode, out, err };
}

function makeTempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'populate-users-'));
}

function makeFetchMock(responses) {
    const calls = [];
    const fetchMock = async (url, options = {}) => {
        calls.push({ url, options });
        const response = responses[url];
        if (!response) {
            throw new Error(`Unexpected fetch: ${url}`);
        }
        return {
            ok: response.ok !== false,
            status: response.status || 200,
            statusText: response.statusText || 'OK',
            json: async () => response.body,
            text: async () => response.text || JSON.stringify(response.body)
        };
    };
    return { fetchMock, calls };
}

function getAuthorizationHeader(call) {
    const headers = call.options && call.options.headers;
    if (!headers) return undefined;
    if (typeof headers.get === 'function') {
        return headers.get('Authorization') || headers.get('authorization') || undefined;
    }
    return headers.Authorization || headers.authorization;
}

function makeCliPreloadFile(dir, responses) {
    const preloadFile = path.join(dir, 'populate-users-preload.js');
    fs.writeFileSync(preloadFile, `
const readline = require('node:readline/promises');

Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: true
});

readline.createInterface = () => ({
    question: async () => 'y',
    close: () => {}
});

const responses = ${JSON.stringify(responses, null, 4)};

global.fetch = async url => {
    const response = responses[url];
    if (!response) {
        throw new Error('Unexpected fetch: ' + url);
    }

    return {
        ok: response.ok !== false,
        status: response.status || 200,
        statusText: response.statusText || 'OK',
        json: async () => response.body,
        text: async () => response.text || JSON.stringify(response.body)
    };
};
`);
    return preloadFile;
}

function makeStandaloneScriptFixture(dir) {
    const scriptFile = path.join(dir, 'populateUsers.js');
    fs.copyFileSync(path.join(__dirname, 'populateUsers.js'), scriptFile);
    return scriptFile;
}

test('normalizeWhitespace trims and collapses spaces', () => {
    assert.strictEqual(normalizeWhitespace('  Adam   Major  '), 'Adam Major');
});

test('uniqueCaseInsensitive removes duplicate aliases while preserving order', () => {
    assert.deepStrictEqual(uniqueCaseInsensitive(['Adam', ' adam ', 'Major']), ['Adam', 'Major']);
});

test('mergeAliases keeps existing aliases and appends the profile name', () => {
    assert.deepStrictEqual(mergeAliases(['Adam Major', 'Adam'], 'Adam Major'), ['Adam Major', 'Adam']);
});

test('isYes accepts yes answers and rejects everything else', () => {
    assert.strictEqual(isYes('y'), true);
    assert.strictEqual(isYes(' yes '), true);
    assert.strictEqual(isYes('no'), false);
});

test('promptForConfirmation uses an injected prompt function when provided', async () => {
    const answer = await promptForConfirmation('Continue? ', async message => {
        assert.strictEqual(message, 'Continue? ');
        return 'yes';
    });

    assert.strictEqual(answer, 'yes');
});

test('promptForConfirmation reads from TTY when no prompt function is provided', async () => {
    const originalCreateInterface = readline.createInterface;
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    let closed = false;

    try {
        Object.defineProperty(process.stdin, 'isTTY', {
            configurable: true,
            value: true
        });

        readline.createInterface = () => ({
            question: async message => {
                assert.strictEqual(message, 'Continue? ');
                return 'yes';
            },
            close: () => {
                closed = true;
            }
        });

        const answer = await promptForConfirmation('Continue? ');

        assert.strictEqual(answer, 'yes');
        assert.strictEqual(closed, true);
    } finally {
        readline.createInterface = originalCreateInterface;
        if (stdinDescriptor) {
            Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
        }
    }
});

test('promptForConfirmation throws when no TTY is available', async () => {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

    try {
        Object.defineProperty(process.stdin, 'isTTY', {
            configurable: true,
            value: false
        });

        await assert.rejects(() => promptForConfirmation('Continue? '), /Interactive confirmation requires a TTY/);
    } finally {
        if (stdinDescriptor) {
            Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
        }
    }
});

test('run logs startup inputs and uses the GitHub token when provided', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: []
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile,
                INPUT_GITHUB_TOKEN: 'ghp_testtoken123'
            },
            () => run({ prompt: async () => 'y' })
        );

        assert.strictEqual(result.exitCode, 0);
        assert.match(result.out, /Starting users\.json population/);
        assert.match(result.out, /Org:\s+Now-Micro/);
        assert.match(result.out, /Output file:/);
        assert.match(result.out, /Token:\s+provided/);
        assert.match(result.out, /GitHub returned 0 org members/);
        assert.strictEqual(getAuthorizationHeader(calls[0]), 'Bearer ghp_testtoken123');
    } finally {
        global.fetch = originalFetch;
    }
});

test('run accepts a token passed directly in options', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: []
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile
            },
            () => run({ token: 'ghp_directtoken456', prompt: async () => 'y' })
        );

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(getAuthorizationHeader(calls[0]), 'Bearer ghp_directtoken456');
    } finally {
        global.fetch = originalFetch;
    }
});

test('run accepts org and output file passed directly in options', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'direct-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/direct-user': {
            body: { name: 'Direct User' }
        }
    };

    const { fetchMock } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv({}, () => run({
            org: 'Now-Micro',
            outputFile,
            prompt: async () => 'y'
        }));

        assert.strictEqual(result.exitCode, 0);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
            'Direct User': 'direct-user'
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('run accepts CLI flags for org, token, and output file', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'flag-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/flag-user': {
            body: { name: '' }
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv({}, () => run({
            argv: ['--org', 'Now-Micro', '--output-file', outputFile, '--github-token', 'ghp_cli123'],
            prompt: async () => 'y'
        }));

        assert.strictEqual(result.exitCode, 0);
        assert.match(result.out, /Starting users\.json population/);
        assert.match(result.out, /Token:\s+provided/);
        assert.strictEqual(getAuthorizationHeader(calls[0]), 'Bearer ghp_cli123');
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
            '': 'flag-user'
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('run accepts the --token alias on the CLI', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: []
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv({}, () => run({
            argv: ['--org', 'Now-Micro', '--output-file', outputFile, '--token', 'ghp_alias123'],
            prompt: async () => 'y'
        }));

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(getAuthorizationHeader(calls[0]), 'Bearer ghp_alias123');
    } finally {
        global.fetch = originalFetch;
    }
});

test('standalone CLI execution covers the main entrypoint', () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    const preloadFile = makeCliPreloadFile(dir, {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'cli-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/cli-user': {
            body: { name: 'CLI User' }
        }
    });

    const result = spawnSync(process.execPath, [
        path.join(__dirname, 'populateUsers.js'),
        '--org', 'Now-Micro',
        '--output-file', outputFile
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_OPTIONS: `--require ${preloadFile}`
        }
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Starting users\.json population/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
        'CLI User': 'cli-user'
    });
});

test('standalone CLI uses default org and output file when no flags are provided', () => {
    const dir = makeTempDir();
    const scriptFile = makeStandaloneScriptFixture(dir);
    const preloadFile = makeCliPreloadFile(dir, {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'default-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/default-user': {
            body: { name: 'Default User' }
        }
    });
    const outputFile = path.join(dir, 'users.json');

    const result = spawnSync(process.execPath, [scriptFile], {
        encoding: 'utf8',
        env: {
            ...process.env,
            NODE_OPTIONS: `--require ${preloadFile}`,
            INPUT_ORG: '',
            INPUT_OUTPUT_FILE: ''
        }
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Org:\s+Now-Micro/);
    assert.match(result.stdout, /Output file:/);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
        'Default User': 'default-user'
    });
});

test('buildUsersObject merges aliases and sorts logins', () => {
    const users = buildUsersObject(
        [
            { login: 'zeta', name: 'Zeta User' },
            { login: 'alpha', name: 'Alpha One' },
            { login: 'blank', name: '' }
        ],
        {
            'Alpha One': 'alpha'
        }
    );

    assert.deepStrictEqual(users, {
        '': 'blank',
        'Alpha One': 'alpha',
        'Zeta User': 'zeta'
    });
});

test('fetchMemberProfiles skips members without a login', async () => {
    const responses = {
        'https://api.github.com/users/undefined': {
            body: { name: 'Should Not Be Used' }
        },
        'https://api.github.com/users/good-user': {
            body: { name: 'Good User' }
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const profiles = await fetchMemberProfiles([
            { login: '' },
            { login: 'good-user' }
        ], 'ghp_test');

        assert.deepStrictEqual(profiles, [
            { login: 'good-user', name: 'Good User' }
        ]);
        assert.strictEqual(calls.length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test('fetchOrgMembers stops when the API returns a non-array page', async () => {
    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: { note: 'not an array' }
        }
    };

    const { fetchMock, calls } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const members = await fetchOrgMembers('Now-Micro', 'ghp_test');

        assert.deepStrictEqual(members, []);
        assert.strictEqual(calls.length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test('buildUsersObject falls back to an existing stored name when profile name is blank', () => {
    const users = buildUsersObject(
        [
            { login: 'BerryFinnamin', name: '' }
        ],
        {
            'Stored Name': 'BERRYFINNAMIN'
        }
    );

    assert.deepStrictEqual(users, {
        'Stored Name': 'BerryFinnamin'
    });
});

test('findExistingNameForLogin returns the matching stored display name', () => {
    assert.strictEqual(findExistingNameForLogin({ 'Stored Name': 'berryfinnamin' }, 'BerryFinnamin'), 'Stored Name');
    assert.strictEqual(findExistingNameForLogin({ 'Stored Name': 'berryfinnamin' }, 'UnknownUser'), '');
});

test('loadExistingUsers reads a valid object and rejects malformed JSON', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'users.json');
    fs.writeFileSync(file, JSON.stringify({ 'Adam Major': 'Beschuetzer', BerryFinnamin: '' }, null, 4));
    assert.deepStrictEqual(loadExistingUsers(file), { 'Adam Major': 'Beschuetzer', BerryFinnamin: '' });

    const badFile = path.join(dir, 'bad.json');
    fs.writeFileSync(badFile, '{ this is not json }');
    assert.throws(() => loadExistingUsers(badFile));
});

test('loadExistingUsers returns empty object for missing and empty files', () => {
    const dir = makeTempDir();
    const missingFile = path.join(dir, 'missing.json');
    const emptyFile = path.join(dir, 'empty.json');

    fs.writeFileSync(emptyFile, '   \n');

    assert.deepStrictEqual(loadExistingUsers(missingFile), {});
    assert.deepStrictEqual(loadExistingUsers(emptyFile), {});
});

test('loadExistingUsers rejects non-object JSON values', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'array.json');
    fs.writeFileSync(file, '[]');

    assert.throws(() => loadExistingUsers(file), /Expected/);
});

test('run writes users.json from GitHub org members and preserves existing names', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    fs.writeFileSync(outputFile, JSON.stringify({ 'Adam Major': 'Beschuetzer' }, null, 4));

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'Beschuetzer' },
                { login: 'new-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/Beschuetzer': {
            body: { name: 'Adam Major' }
        },
        'https://api.github.com/users/new-user': {
            body: { name: 'New User' }
        }
    };

    const { fetchMock } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    let promptMessage = '';

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile
            },
            () => run({ prompt: async message => {
                promptMessage = message;
                return 'y';
            } })
        );

        assert.strictEqual(result.exitCode, 0);
        assert.match(promptMessage, /About to write 2 users/);
        assert.match(result.out, /Wrote 2 users/);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(outputFile, 'utf8')), {
            'Adam Major': 'Beschuetzer',
            'New User': 'new-user'
        });
    } finally {
        global.fetch = originalFetch;
    }
});

test('run skips prompting and writing when the file is already up to date', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    fs.writeFileSync(outputFile, `${JSON.stringify({ 'Same Name': 'same-user' }, null, 4)}\n`);

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'same-user' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/same-user': {
            body: { name: 'Same Name' }
        }
    };

    const { fetchMock } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile
            },
            () => run({ prompt: async () => {
                throw new Error('prompt should not be called when no changes are detected');
            } })
        );

        assert.strictEqual(result.exitCode, 0);
        assert.match(result.out, /No changes detected/);
        assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), `${JSON.stringify({ 'Same Name': 'same-user' }, null, 4)}\n`);
    } finally {
        global.fetch = originalFetch;
    }
});

test('run exits 1 when the output directory does not exist', async () => {
    const { fetchMock } = makeFetchMock({});
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: path.join(makeTempDir(), 'missing', 'users.json')
            },
            () => run()
        );

        assert.strictEqual(result.exitCode, 1);
        assert.match(result.err, /Output directory does not exist/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('run exits 1 when the GitHub API request fails', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            text: 'rate limited'
        }
    };

    const { fetchMock } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;

    try {
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile
            },
            () => run({ prompt: async () => 'y' })
        );

        assert.strictEqual(result.exitCode, 1);
        assert.match(result.err, /GitHub API request failed/);
        assert.match(result.err, /rate limited/);
    } finally {
        global.fetch = originalFetch;
    }
});

test('run aborts without changing files when confirmation is declined', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    fs.writeFileSync(outputFile, JSON.stringify({ 'Old Alias': 'Beschuetzer' }, null, 4));

    const responses = {
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=1': {
            body: [
                { login: 'Beschuetzer' }
            ]
        },
        'https://api.github.com/orgs/Now-Micro/members?per_page=100&page=2': {
            body: []
        },
        'https://api.github.com/users/Beschuetzer': {
            body: { name: 'Adam Major' }
        }
    };

    const { fetchMock } = makeFetchMock(responses);
    const originalFetch = global.fetch;
    global.fetch = fetchMock;
    let promptMessage = '';

    try {
        const before = fs.readFileSync(outputFile, 'utf8');
        const result = await withEnv(
            {
                INPUT_ORG: 'Now-Micro',
                INPUT_OUTPUT_FILE: outputFile
            },
            () => run({ prompt: async message => {
                promptMessage = message;
                return 'no';
            } })
        );

        assert.strictEqual(result.exitCode, 0);
        assert.match(promptMessage, /About to write 1 users/);
        assert.match(result.out, /Aborted\. No files were changed\./);
        assert.strictEqual(fs.readFileSync(outputFile, 'utf8'), before);
    } finally {
        global.fetch = originalFetch;
    }
});