#!/usr/bin/env node
const https = require('https');
const fs = require('fs');

function parseBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        return lower === 'true' || lower === '1' || lower === 'yes';
    }
    return false;
}

function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function log(msg) {
    console.log(msg);
}

function logDebug(msg, debugMode) {
    if (debugMode) {
        console.log(msg);
    }
}

function httpsGet(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'GitHub-Actions',
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        };

        https.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(new Error(`Failed to parse JSON response: ${e.message}`));
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        }).on('error', reject);
    });
}

async function fetchWithRetry(url, token, maxAttempts, debugMode) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            logDebug(`  Attempt ${attempt}: fetching workflow runs...`, debugMode);
            const data = await httpsGet(url, token);
            return data;
        } catch (error) {
            lastError = error;
            logDebug(`  Warning: fetch failed (attempt ${attempt}): ${error.message}`, debugMode);
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, attempt * 1000));
            }
        }
    }
    throw lastError;
}

async function run() {
    const mainJobId = process.env.INPUT_MAIN_JOB_ID;
    const jobIdsThatMustSucceedStr = process.env.INPUT_JOB_IDS_THAT_MUST_SUCCEED;
    const workflowName = process.env.INPUT_WORKFLOW_NAME;
    let requestSize = parseInt(process.env.INPUT_REQUEST_SIZE || '50', 10);
    let retryAttempts = parseInt(process.env.INPUT_RETRY_ATTEMPTS || '3', 10);
    const githubToken = process.env.INPUT_GITHUB_TOKEN;
    const defaultBranch = process.env.INPUT_DEFAULT_BRANCH || 'main';
    const branch = process.env.INPUT_BRANCH;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE);
    const githubRepository = process.env.GITHUB_REPOSITORY;
    const githubOutput = process.env.GITHUB_OUTPUT;

    // Validation
    if (!mainJobId) {
        console.error('❌ INPUT_MAIN_JOB_ID is required');
        process.exit(1);
    }
    if (!jobIdsThatMustSucceedStr) {
        console.error('❌ INPUT_JOB_IDS_THAT_MUST_SUCCEED is required');
        process.exit(1);
    }
    if (!workflowName) {
        console.error('❌ INPUT_WORKFLOW_NAME is required');
        process.exit(1);
    }
    if (!githubToken) {
        console.error('❌ INPUT_GITHUB_TOKEN is required');
        process.exit(1);
    }
    if (!githubRepository) {
        console.error('❌ GITHUB_REPOSITORY environment variable is required');
        process.exit(1);
    }
    if (!githubOutput) {
        console.error('❌ GITHUB_OUTPUT environment variable is required');
        process.exit(1);
    }
    if (!branch) {
        console.error('❌ INPUT_BRANCH is required');
        process.exit(1);
    }

    // Ensure numeric inputs are sane
    if (!Number.isFinite(requestSize) || requestSize <= 0) requestSize = 50;
    if (!Number.isFinite(retryAttempts) || retryAttempts <= 0) retryAttempts = 3;

    const jobIdsThatMustSucceed = jobIdsThatMustSucceedStr.split(',').map(s => s.trim()).filter(Boolean);
    if (jobIdsThatMustSucceed.length === 0) {
        console.error('❌ INPUT_JOB_IDS_THAT_MUST_SUCCEED must contain at least one job ID');
        process.exit(1);
    }

    log(`Looking for last successful ${workflowName} run on branch: ${branch}`);
    log(`Criteria: "${mainJobId}" must succeed AND all of [${jobIdsThatMustSucceed.join(', ')}] must succeed or be skipped`);

    const url = `https://api.github.com/repos/${githubRepository}/actions/workflows/${encodeURIComponent(workflowName)}/runs?per_page=${requestSize}&branch=${encodeURIComponent(branch)}`;

    let runs;
    try {
        runs = await fetchWithRetry(url, githubToken, retryAttempts, debugMode);
    } catch (error) {
        log(`⚠️  Could not fetch workflow runs from GitHub API: ${error.message}`);
        log(`   Reverting to default branch: ${defaultBranch}`);
        fs.appendFileSync(githubOutput, `last_success_sha=${defaultBranch}\n`);
        return;
    }

    if (!runs || !runs.workflow_runs || runs.workflow_runs.length === 0) {
        log(`⚠️  No workflow runs found in the API response. Falling back to default branch: ${defaultBranch}`);
        fs.appendFileSync(githubOutput, `last_success_sha=${defaultBranch}\n`);
        return;
    }

    const runCount = runs.workflow_runs.length;
    log(`Checking workflow runs... (found ${runCount} runs)`);

    let lastSuccessSha = null;
    let foundRunId = null;

    for (const run of runs.workflow_runs) {
        const runId = run.id;
        if (!runId) continue;

        logDebug(`  Checking run ${runId}...`, debugMode);

        // Fetch job details
        let jobs;
        try {
            jobs = await httpsGet(`https://api.github.com/repos/${githubRepository}/actions/runs/${runId}/jobs`, githubToken);
        } catch (error) {
            logDebug(`    Warning: failed to fetch jobs for run ${runId}: ${error.message}`, debugMode);
            continue;
        }

        if (!jobs || !jobs.jobs) {
            logDebug(`    Warning: no jobs found for run ${runId}`, debugMode);
            continue;
        }

        // Match main job by ID or name (exact match, case-insensitive)
        const mainJob = jobs.jobs.find(j => {
            logDebug(j, debugMode);
            logDebug(`      Considering job "${j.id}" (name: "${j.name}") for main job`, debugMode);
            const jIdLower = String(j.id || '').toLowerCase();
            const jNameLower = String(j.name || '').toLowerCase();t
            const mainJobIdLower = mainJobId.toLowerCase();

            return jIdLower === mainJobIdLower || jNameLower === mainJobIdLower;
        });
        const mainJobStatus = mainJob ? mainJob.conclusion : 'missing';

        logDebug(`    Main job "${mainJobId}" conclusion: ${mainJobStatus}`, debugMode);

        // Check test jobs: match case-insensitive exact or startsWith (to handle matrix names like "test (dir)")
        // Support matching by both job ID and job name for flexibility
        const foundTestJobs = jobs.jobs.filter(j => {
            const jIdLower = String(j.id || '').toLowerCase();
            const jNameLower = String(j.name || '').toLowerCase();
            logDebug(`      Considering job "${j.id}" (name: "${j.name}") for test jobs`, debugMode);
            return jobIdsThatMustSucceed.some(tn => {
                logDebug(`        Comparing against test job ID "${tn}"`, debugMode);
                const tnLower = tn.toLowerCase();
                // Match either by ID or name (exact or startsWith)
                return jIdLower === tnLower || jIdLower.startsWith(tnLower) ||
                    jNameLower === tnLower || jNameLower.startsWith(tnLower);
            });
        });
        const foundTestJobNames = foundTestJobs.map(j => j.name);
        const testJobExists = foundTestJobs.length;

        logDebug(`    Found ${testJobExists} test jobs`, debugMode);
        logDebug(`    Test job names: [${foundTestJobNames.join(', ')}]`, debugMode);

        let testStatus = 'missing';
        let allTestsPassed = true;
        if (testJobExists > 0) {
            for (const job of foundTestJobs) {
                logDebug(`      Test job "${job.name}" conclusion: ${job.conclusion}`, debugMode);
                if (job.conclusion !== 'success' && job.conclusion !== 'skipped') {
                    allTestsPassed = false;
                    break;
                }
            }
            testStatus = allTestsPassed ? 'success' : 'failure';
        }

        // Check run status/conclusion
        const runStatus = run.status;
        const runConclusion = run.conclusion;

        logDebug(`    run status: ${runStatus}, conclusion: ${runConclusion}, ${mainJobId}: ${mainJobStatus}, test jobs: ${testJobExists} found [${foundTestJobNames.join(', ')}], status: ${testStatus}`, debugMode);

        // Success criteria:
        // - run must be completed and not cancelled/timed_out/stale
        // - main job must be success
        // - test jobs must be success or skipped
        if (runStatus === 'completed' &&
            !['cancelled', 'timed_out', 'stale'].includes(String(runConclusion)) &&
            mainJobStatus === 'success' &&
            (testStatus === 'success' || testStatus === 'skipped')) {
            log(`    ✅ This run meets success criteria!`);
            lastSuccessSha = run.head_sha;
            foundRunId = runId;
            break;
        } else {
            logDebug(`    ❌ Does not meet criteria`, debugMode);
        }
    }

    log('');
    if (lastSuccessSha) {
        log(`✅ Found qualifying run (ID: ${foundRunId}) with SHA: ${lastSuccessSha}`);
        log(`   Will compare changes against this commit`);
        fs.appendFileSync(githubOutput, `last_success_sha=${lastSuccessSha}\n`);
    } else {
        log(`❌ No runs found that meet success criteria on branch ${branch}`);
        log(`   Falling back to default branch: ${defaultBranch}`);
        fs.appendFileSync(githubOutput, `last_success_sha=${defaultBranch}\n`);
    }
}

if (require.main === module) {
    run().catch(err => {
        console.error(`❌ Unexpected error: ${err.message}`);
        process.exit(1);
    });
}

module.exports = { run, parseBool, httpsGet, fetchWithRetry };
