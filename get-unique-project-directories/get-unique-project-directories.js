const fs = require('fs');
const path = require('path');

const CS_PROJ_EXTENSION = '.csproj';

function parseBool(val, def) {
    if (val === undefined || val === null) return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    return def;
}

function normalizePath(input) {
    if (typeof input !== 'string') return '';
    const stripped = input.trim().replace(/['"\[\]]/g, '');
    const withSlashes = stripped.replace(/\\/g, '/');
    const collapsed = withSlashes.replace(/\/\/+/g, '/');
    return collapsed.replace(/^\/+/g, '').replace(/\/+$/g, '').trim();
}

function toDirectoryOnly(value) {
    const normalized = normalizePath(value);
    if (!normalized) return '';
    const dir = path.posix.dirname(normalized);
    return normalizePath(dir);
}

function findNearestCsproj(inputPath) {
    const normalized = normalizePath(inputPath);
    if (!normalized) return '';

    const absoluteFile = path.resolve(normalized);
    let currentDir = path.dirname(absoluteFile);
    const rootDir = path.parse(absoluteFile).root;

    while (true) {
        try {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            const match = entries.find(entry => entry.isFile() && entry.name.toLowerCase().endsWith(CS_PROJ_EXTENSION));
            if (match) {
                const relative = path.relative(process.cwd(), path.join(currentDir, match.name));
                return normalizePath(relative);
            }
        } catch (err) {
            // Directory might not exist (deleted paths); continue moving upward.
        }

        if (currentDir === rootDir) break;
        const parent = path.dirname(currentDir);
        if (parent === currentDir) break;
        currentDir = parent;
    }

    return normalized;
}

function run() {
    const pattern = process.env.INPUT_PATTERN;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
    const outputIsJson = parseBool(process.env.INPUT_OUTPUT_IS_JSON, true);
    const returnDirOnly = parseBool(process.env.INPUT_RETURN_DIR_ONLY, false);
    const raw = process.env.INPUT_PATHS || '';
    const paths = raw
        .split(',')
        .map(normalizePath)
        .filter(Boolean);

    if (debugMode) {
        console.log('🔍 Debug mode is ON');
        console.log(`🔍 INPUT_PATTERN: ${pattern}`);
        console.log(`🔍 INPUT_PATHS: ${raw}`);
        console.log(`🔍 Cleaned paths: ${paths}`);
        console.log(`🔍 RETURN_DIR_ONLY: ${returnDirOnly}`);
    }

    if (!pattern) {
        console.error('INPUT_PATTERN is required');
        process.exit(1);
    }

    let re;
    try {
        re = new RegExp(pattern);
    } catch (e) {
        console.error(`Invalid regex: ${e.message}`);
        process.exit(1);
    }

    const results = [];
    for (const p of paths) {
        const matches = re.test(p);
        re.lastIndex = 0;
        if (!matches) {
            results.push('');
            if (debugMode) console.log(`🔍 Path '${p}' skipped; does not match pattern.`);
            continue;
        }
        const resolved = findNearestCsproj(p);
        const finalValue = returnDirOnly ? toDirectoryOnly(resolved) : resolved;
        results.push(finalValue);
        if (debugMode) console.log(`🔍 Path '${p}' resolved to '${finalValue}'.`);
    }

    const serialized = outputIsJson ? JSON.stringify(results) : results.join(',');
    if (debugMode) console.log(`🔍 Parent projects: ${serialized}`);

    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        console.error('GITHUB_OUTPUT not set');
        process.exit(1);
    }

    fs.appendFileSync(out, `parent_projects=${serialized}\n`);
}

if (require.main === module) run();
module.exports = { run, findNearestCsproj, normalizePath, parseBool, toDirectoryOnly };
