const fs = require('fs');
const path = require('path');

function parseBool(val, def) {
    if (val === undefined || val === null) return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    return def;
}

function run() {
    const actor = process.env.INPUT_ACTOR;
    const repository = process.env.INPUT_REPOSITORY;
    const workflowRef = process.env.INPUT_WORKFLOW_REF;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, true);
    const permissionsFile = process.env.INPUT_PERMISSIONS_FILE ||
        path.join(process.env.GITHUB_ACTION_PATH || __dirname, '..', '.github', 'permissions.json');

    if (!actor) {
        console.error('❌ INPUT_ACTOR is required');
        process.exit(1);
    }
    if (!repository) {
        console.error('❌ INPUT_REPOSITORY is required');
        process.exit(1);
    }
    if (!workflowRef) {
        console.error('❌ INPUT_WORKFLOW_REF is required');
        process.exit(1);
    }

    // "Now-Micro/CodeBits" → "CodeBits"
    const repoName = repository.split('/').pop();

    // "Now-Micro/CodeBits/.github/workflows/release.yml@refs/heads/main" → "release.yml"
    const workflowFilename = workflowRef.split('@')[0].split('/').pop();

    if (debugMode) {
        console.log(`🔍 Checking authorization...`);
        console.log(`🔍 Actor:        ${actor}`);
        console.log(`🔍 Repository:   ${repository} → ${repoName}`);
        console.log(`🔍 Workflow ref: ${workflowRef} → ${workflowFilename}`);
        console.log(`🔍 Permissions:  ${permissionsFile}`);
    }

    if (!fs.existsSync(permissionsFile)) {
        console.error(`❌ Permissions file not found: ${permissionsFile}`);
        process.exit(1);
    }

    let permissions;
    try {
        permissions = JSON.parse(fs.readFileSync(permissionsFile, 'utf8'));
    } catch (e) {
        console.error(`❌ Failed to parse permissions file: ${e.message}`);
        process.exit(1);
    }

    const workflowPerms = permissions[workflowFilename];
    if (!workflowPerms) {
        console.error(`❌ No permissions defined for workflow '${workflowFilename}'.`);
        console.error(`   Actor '${actor}' is not authorized. Add an entry for '${workflowFilename}' in permissions.json.`);
        process.exit(1);
    }

    const allowedActors = workflowPerms[repoName];
    if (!allowedActors) {
        console.error(`❌ No permissions defined for repository '${repoName}' under workflow '${workflowFilename}'.`);
        console.error(`   Actor '${actor}' is not authorized. Add an entry for '${repoName}' under '${workflowFilename}' in permissions.json.`);
        process.exit(1);
    }

    if (!Array.isArray(allowedActors) || !allowedActors.includes(actor)) {
        console.error(`❌ Actor '${actor}' is not authorized to run '${workflowFilename}' in '${repository}'.`);
        console.error(`   Allowed actors: ${Array.isArray(allowedActors) ? allowedActors.join(', ') : '(none)'}`);
        process.exit(1);
    }

    console.log(`✅ Actor '${actor}' is authorized to run '${workflowFilename}' in '${repository}'.`); // always visible

    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput) {
        console.error('❌ GITHUB_OUTPUT is not set');
        process.exit(1);
    }
    fs.appendFileSync(githubOutput, `authorized=true\n`);
}

if (require.main === module) run();
module.exports = { run };
