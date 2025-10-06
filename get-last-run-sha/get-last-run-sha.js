const fs = require('fs');
const https = require('https');
const { URL } = require('url');

function parseBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (!value) return false;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function extractField(obj, path) {
    if (!path) return undefined;
    return String(path)
        .split('.')
        .reduce((acc, key) => (acc && key in acc ? acc[key] : undefined), obj);
}

function httpRequestJson(url, token, debug) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const options = {
            method: 'GET',
            hostname: parsed.hostname,
            path: `${parsed.pathname}${parsed.search}`,
            headers: {
                'User-Agent': 'now-micro-actions-get-last-run-sha',
                'Accept': 'application/vnd.github+json'
            }
        };

        if (token) {
            options.headers.Authorization = `token ${token}`;
        }

        if (debug) {
            console.log(`🔍 GET ${url}`);
        }

        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                if (debug) {
                    console.log(`   ↳ ${res.statusCode}`);
                }
                if (res.statusCode >= 400) {
                    return reject(new Error(`GitHub API request failed (${res.statusCode}): ${body}`));
                }
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(new Error(`Failed to parse JSON from ${url}: ${err.message}`));
                }
            });
        });

        req.on('error', (err) => reject(new Error(`Request error for ${url}: ${err.message}`)));
        req.end();
    });
}

function evaluateJobs(jobs, testSetupJobName, testJobPrefix, debug) {
    const setupJob = jobs.find(job => job && job.name === testSetupJobName);
    const setupConclusion = setupJob ? setupJob.conclusion : 'missing';

    const testJobs = jobs.filter(job => {
        if (!job || typeof job.name !== 'string') return false;
        if (!job.name.startsWith(testJobPrefix)) return false;
        return job.name !== testSetupJobName;
    });

    let testsConclusion = 'missing';
    if (testJobs.length > 0) {
        const allPassing = testJobs.every(job => ['success', 'skipped'].includes(job.conclusion));
        testsConclusion = allPassing ? 'success' : 'failure';
    }

    if (debug) {
        console.log(`    ${testSetupJobName}: ${setupConclusion}, test jobs: ${testJobs.length}, status: ${testsConclusion}`);
    }

    const meetsCriteria = setupConclusion === 'success' && ['success', 'skipped'].includes(testsConclusion);
    return { meetsCriteria, setupConclusion, testsConclusion, testJobCount: testJobs.length };
}

async function writeOutput(value, appendFn) {
    const outputFile = process.env.GITHUB_OUTPUT;
    if (!outputFile) {
        throw new Error('GITHUB_OUTPUT is not defined. Unable to write outputs.');
    }
    appendFn(outputFile, `last-success-sha=${value || ''}\n`);
}

async function run(deps = {}) {
    const {
        requestJson = httpRequestJson,
        appendFileSync = fs.appendFileSync,
    } = deps;

    try {
        const branch = process.env.INPUT_BRANCH || process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME;
        const debug = parseBoolean(process.env.INPUT_DEBUG_MODE);
        const perPage = parseInt(process.env.INPUT_PER_PAGE || '50', 10);
        const repository = process.env.INPUT_REPOSITORY || process.env.GITHUB_REPOSITORY;
        const runIdField = process.env.INPUT_RUN_ID_FIELD || 'id';
        const testJobPrefix = process.env.INPUT_TEST_JOB_PREFIX || 'test';
        const testSetupJobName = process.env.INPUT_TEST_SETUP_JOB_NAME || 'test-setup';
        const token = process.env.INPUT_GITHUB_TOKEN;
        const workflowFile = process.env.INPUT_WORKFLOW_FILE;

        if (!repository) throw new Error('INPUT_REPOSITORY is required.');
        if (!branch) throw new Error('INPUT_BRANCH is required.');
        if (!token) throw new Error('INPUT_GITHUB_TOKEN is required.');
        if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is not set.');

        if (debug) {
            console.log(`🔧 Inputs -> workflowFile: ${workflowFile}, branch: ${branch}, repository: ${repository}`);
            console.log(`   testSetupJobName: ${testSetupJobName}, testJobPrefix: ${testJobPrefix}, runIdField: ${runIdField}`);
        }

        const encodedBranch = encodeURIComponent(branch);
        const runsUrl = `https://api.github.com/repos/${repository}/actions/workflows/${workflowFile}/runs?per_page=${perPage}&branch=${encodedBranch}`;

        const runsResponse = await requestJson(runsUrl, token, debug);
        const workflowRuns = Array.isArray(runsResponse.workflow_runs) ? runsResponse.workflow_runs : [];

        if (workflowRuns.length === 0) {
            if (debug) console.log('⚠️  No workflow runs returned; using fallback.');
            const fallbackSha = await resolveDefaultBranchSha(repository, token, requestJson, debug);
            await writeOutput(fallbackSha, appendFileSync);
            return;
        }

        for (const run of workflowRuns) {
            const runId = extractField(run, runIdField);
            if (!runId) {
                if (debug) console.log('⚠️  Skipping run without runIdField value.');
                continue;
            }

            if (debug) console.log(`  🔍 Inspecting run ${runId} (${run.head_sha})`);

            const jobsUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs`;
            let jobsList = [];
            try {
                const jobsResponse = await requestJson(jobsUrl, token, debug);
                jobsList = Array.isArray(jobsResponse.jobs) ? jobsResponse.jobs : [];
            } catch (err) {
                console.log(`    ⚠️  Failed to load jobs for run ${runId}: ${err.message}`);
                continue;
            }

            const evaluation = evaluateJobs(jobsList, testSetupJobName, testJobPrefix, debug);
            if (evaluation.meetsCriteria) {
                console.log(`✅ Found qualifying run (ID: ${runId}) with SHA: ${run.head_sha}`);
                await writeOutput(run.head_sha, appendFileSync);
                return;
            }

            if (debug) console.log('    ❌ Does not meet criteria');
        }

        // No qualifying run found; fallback
        console.log('❌ No workflow runs met criteria; falling back to default branch.');
        const fallbackSha = await resolveDefaultBranchSha(repository, token, requestJson, debug);
        await writeOutput(fallbackSha, appendFileSync);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        if (deps?.throwInsteadOfExit) {
            throw error;
        }
        process.exit(1);
    }
}

async function resolveDefaultBranchSha(repository, token, requestJson, debug) {
    const repoUrl = `https://api.github.com/repos/${repository}`;
    const repoInfo = await requestJson(repoUrl, token, debug);
    const defaultBranch = repoInfo && repoInfo.default_branch;
    if (!defaultBranch) {
        throw new Error('Could not determine default branch for repository.');
    }

    const branchUrl = `https://api.github.com/repos/${repository}/branches/${defaultBranch}`;
    const branchInfo = await requestJson(branchUrl, token, debug);
    const sha = branchInfo && branchInfo.commit && branchInfo.commit.sha;
    if (!sha) {
        throw new Error(`Could not resolve default branch SHA for ${defaultBranch}.`);
    }

    return sha;
}

module.exports = {
    run,
    evaluateJobs,
    extractField,
    parseBoolean,
    httpRequestJson,
    resolveDefaultBranchSha,
};

if (require.main === module) {
    run();
}
