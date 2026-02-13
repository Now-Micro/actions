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
    if (!normalized.includes('/')) {
        const absolute = path.resolve(normalized);
        try {
            if (fs.existsSync(absolute)) {
                const stat = fs.statSync(absolute);
                if (stat.isDirectory()) return normalized;
                if (stat.isFile()) return '.';
            }
        } catch (err) {
            // Ignore filesystem probing errors and fall back to heuristics.
        }
        if (normalized.toLowerCase().endsWith(CS_PROJ_EXTENSION)) return '.';
        return normalized;
    }
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

    // No csproj found.
    return '';
}

function run() {
    const pattern = process.env.INPUT_PATTERN;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
    const outputIsJson = parseBool(process.env.INPUT_OUTPUT_IS_JSON, true);
    const fallbackRegexPattern = process.env.INPUT_FALLBACK_REGEX || '';
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
        if (fallbackRegexPattern) console.log(`🔍 FALLBACK_REGEX: ${fallbackRegexPattern}`);
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

    let fallbackRe = null;
    if (fallbackRegexPattern) {
        try {
            fallbackRe = new RegExp(fallbackRegexPattern);
        } catch (e) {
            console.error(`Invalid fallback regex: ${e.message}`);
            process.exit(1);
        }
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
        let candidate = resolved;
        if (!resolved.toLowerCase().endsWith(CS_PROJ_EXTENSION) && fallbackRe) {
            const fallbackSource = resolved || p;
            const match = fallbackRe.exec(fallbackSource);
            if (match) {
                candidate = match[1] !== undefined ? match[1] : match[0];
                if (debugMode) console.log(`🔍 Fallback regex matched '${candidate}' for '${fallbackSource}'.`);
            } else if (debugMode) {
                console.log(`🔍 Fallback regex did not match '${fallbackSource}', omitting entry.`);
            }
            fallbackRe.lastIndex = 0;
        }
        const finalValue = toDirectoryOnly(candidate);
        results.push(finalValue);
        if (debugMode) console.log(`🔍 Path '${p}' resolved to '${finalValue}'.`);
    }

    const uniqueResults = [...new Set(results.filter(Boolean))];
    if (debugMode && uniqueResults.length !== results.length) {
        console.log(`🔍 Removed ${results.length - uniqueResults.length} duplicates and/or empty values.`);
    }

    const serialized = outputIsJson ? JSON.stringify(uniqueResults) : uniqueResults.join(',');
    if (debugMode) console.log(`🔍 Parent projects: ${serialized}`);

    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        console.error('GITHUB_OUTPUT not set');
        process.exit(1);
    }

    fs.appendFileSync(out, `unique_project_directories=${serialized}\n`);
}

if (require.main === module) run();
module.exports = { run, findNearestCsproj, normalizePath, parseBool, toDirectoryOnly };
