const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { run, evaluateJobs, extractField, parseBoolean } = require('./get-last-run-sha');

async function withPatchedEnv(env, fn) {
    const original = { ...process.env };
    Object.assign(process.env, env);
    try {
        return await fn();
    } finally {
        Object.keys(process.env).forEach((key) => {
            if (!(key in original)) delete process.env[key];
        });
        Object.entries(original).forEach(([k, v]) => {
            process.env[k] = v;
        });
    }
}

async function captureRun({ env = {}, responses = {}, errors = {}, debug = false }) {
    const logs = [];
    const origLog = console.log;
    const origError = console.error;
    console.log = (...args) => logs.push(args.join(' '));
    console.error = (...args) => logs.push(args.join(' '));

    const outputWrites = [];
    const appendFileSync = (file, content) => {
        outputWrites.push({ file, content });
        fs.appendFileSync(file, content, 'utf8');
    };

    const requestJson = async (url) => {
        if (debug) logs.push(`DEBUG: request ${url}`);
        if (errors[url]) throw errors[url];
        if (!(url in responses)) throw new Error(`Unexpected request: ${url}`);
        return responses[url];
    };

    const tmpOutput = path.join(os.tmpdir(), `glrs-${Date.now()}-${Math.random()}.txt`);
    // Ensure GITHUB_OUTPUT exists and provide a default workflow file when tests omit it
    env = { ...env, GITHUB_OUTPUT: tmpOutput };
    if (!('INPUT_WORKFLOW_FILE' in env)) env.INPUT_WORKFLOW_FILE = 'checks.yml';
    fs.writeFileSync(tmpOutput, '', 'utf8');

    let exitCode = 0;
    const origExit = process.exit;
    process.exit = (code) => {
        exitCode = typeof code === 'number' ? code : 0;
        throw new Error(`__EXIT_${exitCode}__`);
    };

    let thrown;
    try {
        await withPatchedEnv(env, async () => {
            try {
                await run({ requestJson, appendFileSync });
            } catch (err) {
                if (!/^__EXIT_/.test(err.message)) {
                    thrown = err;
                }
                throw err;
            }
        });
    } catch (err) {
        if (!/^__EXIT_/.test(err.message)) {
            throw err;
        }
    } finally {
        console.log = origLog;
        console.error = origError;
        process.exit = origExit;
    }

    const output = fs.existsSync(tmpOutput) ? fs.readFileSync(tmpOutput, 'utf8') : '';
    return { logs, output, exitCode, outputWrites, thrown };
}

// --- evaluateJobs tests ---

test('evaluateJobs recognizes passing setup and tests', () => {
    const jobs = [
        { name: 'test-setup', conclusion: 'success' },
        { name: 'test (api)', conclusion: 'success' },
        { name: 'test (ui)', conclusion: 'skipped' }
    ];
    const result = evaluateJobs(jobs, 'test-setup', 'test');
    assert.strictEqual(result.meetsCriteria, true);
    assert.strictEqual(result.testJobCount, 2);
});

test('evaluateJobs rejects when setup fails', () => {
    const jobs = [
        { name: 'test-setup', conclusion: 'failure' },
        { name: 'test (api)', conclusion: 'success' }
    ];
    const result = evaluateJobs(jobs, 'test-setup', 'test');
    assert.strictEqual(result.meetsCriteria, false);
});

test('evaluateJobs excludes setup job from test prefix matches', () => {
    const jobs = [
        { name: 'test-setup', conclusion: 'success' },
        { name: 'test (component)', conclusion: 'failure' }
    ];
    const result = evaluateJobs(jobs, 'test-setup', 'test');
    assert.strictEqual(result.meetsCriteria, false);
    assert.strictEqual(result.testJobCount, 1);
});

// --- extractField / parseBoolean ---

test('extractField reads nested properties', () => {
    const obj = { outer: { inner: { value: 42 } } };
    assert.strictEqual(extractField(obj, 'outer.inner.value'), 42);
    assert.strictEqual(extractField(obj, 'outer.missing'), undefined);
});

test('parseBoolean handles various truthy values', () => {
    assert.ok(parseBoolean('true'));
    assert.ok(parseBoolean('YES'));
    assert.ok(parseBoolean('1'));
    assert.ok(!parseBoolean('no'));
    assert.ok(!parseBoolean('false'));
});

// --- run() integration tests ---

test('run writes SHA for qualifying run', async () => {
    const repository = 'org/repo';
    const runId = 111;
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [
                { id: runId, head_sha: 'abc123' }
            ]
        },
        [`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`]: {
            jobs: [
                { name: 'test-setup', conclusion: 'success' },
                { name: 'test (api)', conclusion: 'success' }
            ]
        }
    };

    const { output, exitCode } = await captureRun({
        env: {
            INPUT_BRANCH: 'feature',
            INPUT_REPOSITORY: repository,
            INPUT_GITHUB_TOKEN: 'token',
        },
        responses
    });

    assert.strictEqual(exitCode, 0);
    assert.match(output, /last-success-sha=abc123/);
});

test('run supports custom run id field', async () => {
    const repository = 'org/repo';
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/main.yml/runs?per_page=25&branch=feature`]: {
            workflow_runs: [
                { metadata: { id: 222 }, head_sha: 'def456' }
            ]
        },
        [`https://api.github.com/repos/${repository}/actions/runs/222/jobs`]: {
            jobs: [
                { name: 'setup', conclusion: 'success' },
                { name: 'tests', conclusion: 'success' }
            ]
        }
    };

    const { output } = await captureRun({
        env: {
            INPUT_WORKFLOW_FILE: 'main.yml',
            INPUT_BRANCH: 'feature',
            INPUT_REPOSITORY: repository,
            INPUT_GITHUB_TOKEN: 'token',
            INPUT_RUN_ID_FIELD: 'metadata.id',
            INPUT_PER_PAGE: '25',
            INPUT_TEST_SETUP_JOB_NAME: 'setup',
            INPUT_TEST_JOB_PREFIX: 'test'
        },
        responses
    });

    assert.match(output, /last-success-sha=def456/);
});

test('run falls back to default branch SHA when no runs qualify', async () => {
    const repository = 'org/repo';
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [
                { id: 1, head_sha: 'aaa111' }
            ]
        },
        [`https://api.github.com/repos/${repository}/actions/runs/1/jobs`]: {
            jobs: [
                { name: 'test-setup', conclusion: 'success' },
                { name: 'test (api)', conclusion: 'failure' }
            ]
        },
        [`https://api.github.com/repos/${repository}`]: {
            default_branch: 'main'
        },
        [`https://api.github.com/repos/${repository}/branches/main`]: {
            commit: { sha: 'main-sha-999' }
        }
    };

    const { output, logs } = await captureRun({
        env: {
            INPUT_BRANCH: 'feature',
            INPUT_REPOSITORY: repository,
            INPUT_GITHUB_TOKEN: 'token'
        },
        responses
    });

    assert.match(output, /last-success-sha=main-sha-999/);
    assert.ok(logs.some(line => line.includes('falling back')));
});

test('run falls back when workflow_runs array empty', async () => {
    const repository = 'org/repo';
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: []
        },
        [`https://api.github.com/repos/${repository}`]: {
            default_branch: 'main'
        },
        [`https://api.github.com/repos/${repository}/branches/main`]: {
            commit: { sha: 'main-sha-000' }
        }
    };

    const { output } = await captureRun({
        env: {
            INPUT_BRANCH: 'feature',
            INPUT_REPOSITORY: repository,
            INPUT_GITHUB_TOKEN: 'token'
        },
        responses
    });

    assert.match(output, /last-success-sha=main-sha-000/);
});

test('run exits with error when required inputs missing', async () => {
    const { exitCode, logs } = await captureRun({
        env: {
            INPUT_REPOSITORY: 'org/repo',
            INPUT_GITHUB_TOKEN: 'token'
        }
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(logs.some(line => line.includes('INPUT_BRANCH is required')));
});

test('run exits on GitHub API error', async () => {
    const repository = 'org/repo';
    const errors = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: new Error('rate limited')
    };

    const { exitCode, logs } = await captureRun({
        env: {
            INPUT_BRANCH: 'feature',
            INPUT_REPOSITORY: repository,
            INPUT_GITHUB_TOKEN: 'token'
        },
        errors
    });

    assert.strictEqual(exitCode, 1);
    assert.ok(logs.some(line => line.includes('rate limited')));
});
