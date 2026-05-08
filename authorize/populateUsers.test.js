const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    buildUsersObject,
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

test('buildUsersObject merges aliases and sorts logins', () => {
    const users = buildUsersObject(
        [
            { login: 'zeta', name: 'Zeta User' },
            { login: 'alpha', name: 'Alpha One' }
        ],
        {
            alpha: ['Alpha One', 'A. One']
        }
    );

    assert.deepStrictEqual(users, {
        alpha: ['Alpha One', 'A. One'],
        zeta: ['Zeta User']
    });
});

test('loadExistingUsers reads a valid object and rejects malformed JSON', () => {
    const dir = makeTempDir();
    const file = path.join(dir, 'users.json');
    fs.writeFileSync(file, JSON.stringify({ Beschuetzer: ['Adam Major'] }, null, 4));
    assert.deepStrictEqual(loadExistingUsers(file), { Beschuetzer: ['Adam Major'] });

    const badFile = path.join(dir, 'bad.json');
    fs.writeFileSync(badFile, '{ this is not json }');
    assert.throws(() => loadExistingUsers(badFile));
});

test('run writes users.json from GitHub org members and preserves existing aliases', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    fs.writeFileSync(outputFile, JSON.stringify({ Beschuetzer: ['Adam Major', 'Adam'] }, null, 4));

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
            Beschuetzer: ['Adam Major', 'Adam'],
            'new-user': ['New User']
        });
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

test('run aborts without changing files when confirmation is declined', async () => {
    const dir = makeTempDir();
    const outputFile = path.join(dir, 'users.json');
    fs.writeFileSync(outputFile, JSON.stringify({ Beschuetzer: ['Old Alias'] }, null, 4));

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