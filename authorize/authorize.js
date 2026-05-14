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

function findCaseInsensitive(obj, key) {
    const lower = key.toLowerCase();
    const found = Object.keys(obj).find(k => k.toLowerCase() === lower);
    return found !== undefined ? obj[found] : undefined;
}

function findCaseInsensitiveKey(obj, key) {
    const lower = key.toLowerCase();
    return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function loadUsers(filePath, debugMode) {
    if (!fs.existsSync(filePath)) {
        if (debugMode) {
            console.log(`🔍 Users file not found: ${filePath} (alias resolution disabled)`);
        }
        return {};
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
        if (debugMode) {
            console.log(`🔍 Users file is empty: ${filePath}`);
        }
        return {};
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`Expected ${filePath} to contain a JSON object.`);
    }

    const normalized = {};
    for (const [displayName, login] of Object.entries(parsed)) {
        normalized[String(displayName).trim()] = String(login).trim();
    }

    if (debugMode) {
        console.log(`🔍 Users file: ${filePath}`);
        console.log(`🔍 Loaded ${Object.keys(normalized).length} alias entr${Object.keys(normalized).length === 1 ? 'y' : 'ies'} from users.json`);
    }

    return normalized;
}

function resolveActorDisplayName(actor, users) {
    const lowerActor = actor.toLowerCase();
    const foundKey = Object.keys(users).find(key => users[key].toLowerCase() === lowerActor);
    return foundKey !== undefined ? foundKey : '';
}

function resolveAllowedActorLogin(allowedActor, users) {
    const direct = String(allowedActor).trim();
    const matchingDisplayName = findCaseInsensitiveKey(users, direct);
    if (matchingDisplayName !== undefined) {
        return users[matchingDisplayName];
    }

    return direct;
}

function run() {
    const actor = process.env.INPUT_ACTOR;
    const repository = process.env.INPUT_REPOSITORY;
    const workflowRef = process.env.INPUT_WORKFLOW_REF;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, true);
    const permissionsFile = path.join(process.env.GITHUB_ACTION_PATH || __dirname, 'permissions.json');

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
    let users = {};
    let actorAlias = '';
    try {
        const raw = fs.readFileSync(permissionsFile, 'utf8');
        if (debugMode) {
            console.log(`🔍 Permissions file contents:\n${raw}`);
        }
        permissions = JSON.parse(raw);

        const usersFile = path.join(path.dirname(permissionsFile), 'users.json');
        users = loadUsers(usersFile, debugMode);
        actorAlias = resolveActorDisplayName(actor, users);
        if (debugMode) {
            if (actorAlias) {
                console.log(`🔍 Actor alias resolved: '${actor}' → '${actorAlias}'`);
            } else if (Object.keys(users).length > 0) {
                console.log(`🔍 No alias match found for actor '${actor}' in users.json`);
            }
        }
    } catch (e) {
        console.error(`❌ Failed to parse permissions or users file: ${e.message}`);
        process.exit(1);
    }

    // Gather all applicable allowed-actor lists, respecting '*' wildcards at both levels.
    // Checks (all contribute): repo/workflow, repo/*, */workflow, */*
    const exactRepoPerms = findCaseInsensitive(permissions, repoName);
    const wildcardRepoPerms = repoName !== '*' ? findCaseInsensitive(permissions, '*') : null;

    const allowedActorLists = [];

    if (exactRepoPerms) {
        const exact = findCaseInsensitive(exactRepoPerms, workflowFilename);
        if (exact !== undefined) allowedActorLists.push(Array.isArray(exact) ? exact : []);
        if (workflowFilename !== '*') {
            const wildcardWf = findCaseInsensitive(exactRepoPerms, '*');
            if (wildcardWf !== undefined) allowedActorLists.push(Array.isArray(wildcardWf) ? wildcardWf : []);
        }
    }

    if (wildcardRepoPerms) {
        const exact = findCaseInsensitive(wildcardRepoPerms, workflowFilename);
        if (exact !== undefined) allowedActorLists.push(Array.isArray(exact) ? exact : []);
        if (workflowFilename !== '*') {
            const wildcardWf = findCaseInsensitive(wildcardRepoPerms, '*');
            if (wildcardWf !== undefined) allowedActorLists.push(Array.isArray(wildcardWf) ? wildcardWf : []);
        }
    }

    if (allowedActorLists.length === 0) {
        if (!exactRepoPerms && !wildcardRepoPerms) {
            console.error(`❌ No permissions defined for repository '${repoName}'.`);
            console.error(`   Actor '${actor}' is not authorized. Add an entry for '${repoName}' or '*' in permissions.json.`);
        } else {
            console.error(`❌ No permissions defined for workflow '${workflowFilename}' under repository '${repoName}'.`);
            console.error(`   Actor '${actor}' is not authorized. Add an entry for '${workflowFilename}' or '*' under '${repoName}' or '*' in permissions.json.`);
        }
        process.exit(1);
    }

    const allowedActorList = allowedActorLists.flat();
    let authorizedByAlias = '';
    const actorLower = actor.toLowerCase();
    const actorDisplayLower = actorAlias.toLowerCase();

    const isAuthorized = allowedActorList.some(allowedActor => {
        const resolvedLogin = resolveAllowedActorLogin(allowedActor, users);
        const resolvedLower = String(resolvedLogin).trim().toLowerCase();
        if (resolvedLower === actorLower || (actorDisplayLower && resolvedLower === actorDisplayLower)) {
            if (resolvedLogin.toLowerCase() !== String(allowedActor).trim().toLowerCase()) {
                authorizedByAlias = `${String(allowedActor).trim()} → ${resolvedLogin}`;
            }
            return true;
        }
        return false;
    });

    if (!isAuthorized) {
        console.error(`❌ Actor '${actor}' is not authorized to run '${workflowFilename}' in '${repository}'.`);
        console.error(`   Allowed actors: ${allowedActorList.length > 0 ? allowedActorList.join(', ') : '(none)'}`);
        process.exit(1);
    }

    if (debugMode && authorizedByAlias) {
        console.log(`🔍 Authorization resolved via alias: ${authorizedByAlias}`);
    }

    console.log(`✅ Actor '${actor}' is authorized to run '${workflowFilename}' in '${repository}'.`); // always visible
}

if (require.main === module) run();
module.exports = { run };
