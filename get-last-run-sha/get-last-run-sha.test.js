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

// --- additional deterministic unit tests ---
test('resolveDefaultBranchSha returns commit SHA on success', async () => {
    const { resolveDefaultBranchSha } = require('./get-last-run-sha');
    const calls = [];
    const fakeRequest = async (url) => {
        calls.push(url);
        if (url.endsWith('/repos/org/repo')) return { default_branch: 'main' };
        if (url.endsWith('/branches/main')) return { commit: { sha: 'branch-sha-123' } };
        throw new Error('unexpected');
    };

    const sha = await resolveDefaultBranchSha('org/repo', 'tok', fakeRequest, false);
    assert.strictEqual(sha, 'branch-sha-123');
    assert.ok(calls.length === 2);
});

test('writeOutput throws when GITHUB_OUTPUT missing', async () => {
    const { writeOutput } = require('./get-last-run-sha');
    const orig = process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_OUTPUT;
    let threw = false;
    try {
        await writeOutput('abc', (f, c) => { });
    } catch (err) {
        threw = true;
        assert.ok(/GITHUB_OUTPUT is not defined/.test(err.message));
    }
    if (orig !== undefined) process.env.GITHUB_OUTPUT = orig;
    assert.ok(threw);
});

test('extractField with empty path returns undefined', () => {
    const { extractField } = require('./get-last-run-sha');
    assert.strictEqual(extractField({ a: 1 }, ''), undefined);
});

test('httpRequestJson rejects on 500 status', async () => {
    const mod = require('./get-last-run-sha');
    const orig = require('https');
    const fakeHttps = {
        request: (options, cb) => {
            let dataHandler, endHandler;
            const res = { statusCode: 500, on: (ev, h) => { if (ev === 'data') dataHandler = h; if (ev === 'end') endHandler = h; } };
            // call callback synchronously so handlers are attached before end()
            cb(res);
            return { on() { }, end: () => { if (dataHandler) dataHandler(Buffer.from('error')); if (endHandler) endHandler(); } };
        }
    };
    mod.__setHttps(fakeHttps);

    let threw = false;
    try { await mod.httpRequestJson('https://api.github.com/x', 't'); } catch (err) { threw = true; assert.ok(/GitHub API request failed/.test(err.message)); }
    mod.__setHttps(orig);
    assert.ok(threw);
});

test('httpRequestJson rejects on invalid JSON', async () => {
    const mod = require('./get-last-run-sha');
    const orig = require('https');
    const fakeHttps = {
        request: (options, cb) => {
            let dataHandler, endHandler;
            const res = { statusCode: 200, on: (ev, h) => { if (ev === 'data') dataHandler = h; if (ev === 'end') endHandler = h; } };
            cb(res);
            return { on() { }, end: () => { if (dataHandler) dataHandler(Buffer.from('not-json')); if (endHandler) endHandler(); } };
        }
    };
    mod.__setHttps(fakeHttps);

    let threw = false;
    try { await mod.httpRequestJson('https://api.github.com/x', 't'); } catch (err) { threw = true; assert.ok(/Failed to parse JSON/.test(err.message)); }
    mod.__setHttps(orig);
    assert.ok(threw);
});

test('httpRequestJson rejects on request error', async () => {
    const mod = require('./get-last-run-sha');
    const orig = require('https');
    const fakeHttps = {
        request: (options, cb) => {
            let dataHandler, endHandler, errorHandler;
            const res = { statusCode: 200, on: (ev, h) => { if (ev === 'data') dataHandler = h; if (ev === 'end') endHandler = h; } };
            cb(res);
            return {
                on: (name, handler) => { if (name === 'error') errorHandler = handler; },
                end: () => { if (errorHandler) process.nextTick(() => errorHandler(new Error('socket fail'))); else { if (dataHandler) dataHandler(Buffer.from('{}')); if (endHandler) endHandler(); } }
            };
        }
    };
    mod.__setHttps(fakeHttps);

    let threw = false;
    try { await mod.httpRequestJson('https://api.github.com/x', 't'); } catch (err) { threw = true; assert.ok(/Request error/.test(err.message)); }
    mod.__setHttps(orig);
    assert.ok(threw);
});

test('run logs when jobs fetch fails and falls back', async () => {
    const repository = 'org/repo';
    const runId = 7;
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [{ id: runId, head_sha: 'zzz' }]
        },
        // repo info for fallback
        [`https://api.github.com/repos/${repository}`]: { default_branch: 'main' },
        [`https://api.github.com/repos/${repository}/branches/main`]: { commit: { sha: 'fallback-sha' } }
    };

    const errors = {
        [`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`]: new Error('jobs fetch failed')
    };

    const { logs, output } = await captureRun({
        env: { INPUT_BRANCH: 'feature', INPUT_REPOSITORY: repository, INPUT_GITHUB_TOKEN: 'token' },
        responses, errors
    });

    assert.ok(logs.some(l => l.includes('Failed to load jobs for run') || l.includes('Failed to load jobs')));
    assert.match(output, /last-success-sha=fallback-sha/);
});

test('httpRequestJson does not set Authorization header when token omitted', async () => {
    const mod = require('./get-last-run-sha');
    const orig = require('https');
    let capturedOptions;
    const fakeHttps = {
        request: (options, cb) => {
            capturedOptions = options;
            const res = { statusCode: 200, on: (ev, h) => { if (ev === 'data') data = h; if (ev === 'end') end = h; } };
            cb(res);
            return { on() { }, end: () => { /* no body needed for this assertion */ } };
        }
    };
    mod.__setHttps(fakeHttps);

    // Provide a minimal requestJson call that will not hang: return quick JSON via replacing httpRequestJson internals
    // We'll simulate by calling httpRequestJson but not relying on body parsing here; instead ensure options were captured
    try {
        // call and ignore result; fakeHttps.end will cause no data but should still set capturedOptions
        const p = mod.httpRequestJson('https://api.github.com/x', undefined, false);
        // ensure promise doesn't hang by cancelling via timeout if necessary
        await Promise.race([p.catch(() => { }), new Promise(res => setTimeout(res, 10))]);
    } finally {
        mod.__setHttps(orig);
    }

    assert.ok(capturedOptions);
    assert.ok(!capturedOptions.headers.Authorization);
});

test('run skips run without runId when debug mode enabled', async () => {
    const repository = 'org/repo';
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [{ head_sha: 'noid' }]
        },
        [`https://api.github.com/repos/${repository}`]: { default_branch: 'main' },
        [`https://api.github.com/repos/${repository}/branches/main`]: { commit: { sha: 'fallback-s' } }
    };

    const { logs, output } = await captureRun({
        env: { INPUT_BRANCH: 'feature', INPUT_REPOSITORY: repository, INPUT_GITHUB_TOKEN: 'token', INPUT_DEBUG_MODE: 'true' },
        responses
    });

    assert.ok(logs.some(l => l.includes('Skipping run without runIdField') || l.includes('Skipping run')));
    assert.match(output, /last-success-sha=fallback-s/);
});

test('evaluateJobs ignores non-string job names', () => {
    const jobs = [{ name: 'test-setup', conclusion: 'success' }, { name: null, conclusion: 'success' }, { name: 'test (ok)', conclusion: 'success' }];
    const res = require('./get-last-run-sha').evaluateJobs(jobs, 'test-setup', 'test');
    assert.strictEqual(res.meetsCriteria, true);
    assert.strictEqual(res.testJobCount, 1);
});

test('httpRequestJson debug logs include status code', async () => {
    const mod = require('./get-last-run-sha');
    const orig = require('https');
    const fakeHttps = {
        request: (options, cb) => {
            let dataHandler, endHandler;
            const res = { statusCode: 200, on: (ev, h) => { if (ev === 'data') dataHandler = h; if (ev === 'end') endHandler = h; } };
            cb(res);
            return { on() { }, end: () => { if (dataHandler) dataHandler(Buffer.from(JSON.stringify({ ok: true }))); if (endHandler) endHandler(); } };
        }
    };
    mod.__setHttps(fakeHttps);
    const logs = [];
    const ol = console.log; console.log = (...a) => logs.push(a.join(' '));
    try {
        const data = await mod.httpRequestJson('https://api.github.com/x', 'tok', true);
        assert.deepStrictEqual(data, { ok: true });
    } finally {
        mod.__setHttps(orig);
        console.log = ol;
    }
    assert.ok(logs.some(l => l.includes('↳ 200')) || logs.some(l => l.includes('200')));
});

test('parseBoolean returns booleans unchanged', () => {
    const { parseBoolean } = require('./get-last-run-sha');
    assert.strictEqual(parseBoolean(true), true);
    assert.strictEqual(parseBoolean(false), false);
});

test('run debug logs "Does not meet criteria" when tests fail', async () => {
    const repository = 'org/repo';
    const runId = 42;
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [{ id: runId, head_sha: 'abc' }]
        },
        [`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`]: {
            jobs: [{ name: 'test-setup', conclusion: 'success' }, { name: 'test (api)', conclusion: 'failure' }]
        },
        [`https://api.github.com/repos/${repository}`]: { default_branch: 'main' },
        [`https://api.github.com/repos/${repository}/branches/main`]: { commit: { sha: 'fb' } }
    };

    const { logs, output } = await captureRun({
        env: { INPUT_BRANCH: 'feature', INPUT_REPOSITORY: repository, INPUT_GITHUB_TOKEN: 'token', INPUT_DEBUG_MODE: 'true' },
        responses
    });

    assert.ok(logs.some(l => l.includes('Does not meet criteria') || l.includes('❌ Does not meet criteria') || l.includes('Does not meet')));
    assert.match(output, /last-success-sha=fb/);
});

test('resolveDefaultBranchSha errors when branch info missing commit', async () => {
    const { resolveDefaultBranchSha } = require('./get-last-run-sha');
    const fakeRequest = async (url) => {
        if (url.endsWith('/repos/org/repo')) return { default_branch: 'main' };
        if (url.endsWith('/branches/main')) return {}; // missing commit
        return {};
    };

    let threw = false;
    try { await resolveDefaultBranchSha('org/repo', 'tok', fakeRequest, false); } catch (err) { threw = true; assert.ok(/Could not resolve default branch SHA/.test(err.message)); }
    assert.ok(threw);
});

test('run handles jobsResponse with no jobs array', async () => {
    const repository = 'org/repo';
    const runId = 99;
    const responses = {
        [`https://api.github.com/repos/${repository}/actions/workflows/checks.yml/runs?per_page=50&branch=feature`]: {
            workflow_runs: [{ id: runId, head_sha: 'nojobs' }]
        },
        [`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`]: {
            // no jobs key
        },
        [`https://api.github.com/repos/${repository}`]: { default_branch: 'main' },
        [`https://api.github.com/repos/${repository}/branches/main`]: { commit: { sha: 'fallback2' } }
    };

    const { output, logs } = await captureRun({ env: { INPUT_BRANCH: 'feature', INPUT_REPOSITORY: repository, INPUT_GITHUB_TOKEN: 'token', INPUT_DEBUG_MODE: 'true' }, responses });
    assert.match(output, /last-success-sha=fallback2/);
    assert.ok(logs.some(l => l.includes('Does not meet') || l.includes('Skipping')));
});
