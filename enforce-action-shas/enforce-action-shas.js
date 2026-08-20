const fs = require('fs');
const path = require('path');

const SHA_REGEX = /^[0-9a-f]{40}$/i;
const USES_LINE_REGEX = /^\s*(?:-\s*)?uses:\s*['"]?([^'"#\s]+)/;
const YAML_FILE_REGEX = /\.ya?ml$/i;
// Applied only when exclude-action-pattern is not provided; an explicit input replaces this rather than merging with it.
const DEFAULT_EXCLUDE_ACTION_PATTERN = '^(Now-Micro|trafera-llc)/actions(/|$)';

function parseBool(val, def) {
    if (val === undefined || val === null || val === '') return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    return def;
}

function parseList(raw) {
    return (raw || '')
        .split(',')
        .map(s => s.trim().replace(/["'\[\]]/g, ''))
        .filter(Boolean);
}

function toPosix(p) {
    return p.split(path.sep).join('/');
}

// Matches a relative path against exclude entries by exact match, prefix, or path segment.
function isExcludedPath(relPath, excludeDirs) {
    const posixPath = toPosix(relPath);
    const segments = posixPath.split('/');
    return excludeDirs.some(dir => {
        const normalized = toPosix(dir).replace(/^\.\//, '').replace(/\/+$/, '');
        if (!normalized) return false;
        return posixPath === normalized || posixPath.startsWith(`${normalized}/`) || segments.includes(normalized);
    });
}

function collectYamlFiles(rootDir, excludeDirs, debugMode) {
    const results = [];
    function walk(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            if (debugMode) console.log(`🔍 Skipping unreadable path '${dir}': ${e.message}`);
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(process.cwd(), fullPath);
            if (isExcludedPath(relPath, excludeDirs)) {
                if (debugMode) console.log(`🔍 Excluding '${toPosix(relPath)}'`);
                continue;
            }
            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile() && YAML_FILE_REGEX.test(entry.name)) {
                results.push(fullPath);
            }
        }
    }
    walk(rootDir);
    return results;
}

function checkFile(filePath, excludeActionRegex, debugMode) {
    const violations = [];
    const relPath = toPosix(path.relative(process.cwd(), filePath));
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
        const match = line.match(USES_LINE_REGEX);
        if (!match) return;
        const usesValue = match[1];
        if (debugMode) console.log(`🔍 ${relPath}:${idx + 1} uses '${usesValue}'`);

        // Local action/workflow references and docker images are not commit-SHA-pinnable in the same way.
        if (usesValue.startsWith('./') || usesValue.startsWith('../') || usesValue.startsWith('docker://')) {
            if (debugMode) console.log(`🔍 Skipping local/docker reference '${usesValue}'`);
            return;
        }

        const atIndex = usesValue.lastIndexOf('@');
        const actionName = atIndex === -1 ? usesValue : usesValue.slice(0, atIndex);
        const ref = atIndex === -1 ? '' : usesValue.slice(atIndex + 1);

        if (excludeActionRegex && excludeActionRegex.test(actionName)) {
            if (debugMode) console.log(`🔍 Excluding '${actionName}' (matches exclude-action-pattern)`);
            return;
        }

        if (!ref) {
            violations.push({ file: relPath, line: idx + 1, uses: usesValue, reason: 'missing a pinned ref (no @ref found)' });
        } else if (!SHA_REGEX.test(ref)) {
            violations.push({ file: relPath, line: idx + 1, uses: usesValue, reason: `ref '${ref}' is not a full 40-character commit SHA` });
        }
    });
    return violations;
}

function run() {
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
    const scanPaths = parseList(process.env.INPUT_SCAN_PATHS || '.github/workflows');
    const excludeDirs = parseList(process.env.INPUT_EXCLUDE_DIRS);
    const excludeActionPatternRaw = (process.env.INPUT_EXCLUDE_ACTION_PATTERN || DEFAULT_EXCLUDE_ACTION_PATTERN).trim();

    if (debugMode) {
        console.log('🔍 Debug mode is ON');
        console.log(`🔍 INPUT_SCAN_PATHS: ${scanPaths.join(', ') || '(none)'}`);
        console.log(`🔍 INPUT_EXCLUDE_DIRS: ${excludeDirs.join(', ') || '(none)'}`);
        console.log(`🔍 INPUT_EXCLUDE_ACTION_PATTERN: ${excludeActionPatternRaw}`);
    }

    if (scanPaths.length === 0) {
        console.error('❌ Exiting because scan-paths resolved to no paths to scan.');
        process.exit(1);
    }

    let excludeActionRegex = null;
    if (excludeActionPatternRaw) {
        try {
            excludeActionRegex = new RegExp(excludeActionPatternRaw);
        } catch (e) {
            console.error(`❌ Exiting because exclude-action-pattern is not a valid regex: ${e.message}`);
            process.exit(1);
        }
    }

    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        console.error('❌ Exiting because GITHUB_OUTPUT is not set.');
        process.exit(1);
    }

    let allViolations = [];
    let filesScanned = 0;

    for (const scanPath of scanPaths) {
        if (!fs.existsSync(scanPath)) {
            if (debugMode) console.log(`🔍 Scan path '${scanPath}' does not exist, skipping`);
            continue;
        }
        const stat = fs.statSync(scanPath);
        const files = stat.isDirectory()
            ? collectYamlFiles(scanPath, excludeDirs, debugMode)
            : (YAML_FILE_REGEX.test(scanPath) ? [scanPath] : []);
        for (const file of files) {
            filesScanned++;
            allViolations = allViolations.concat(checkFile(file, excludeActionRegex, debugMode));
        }
    }

    console.log(`🔍 Scanned ${filesScanned} workflow file(s) across: ${scanPaths.join(', ')}`);

    fs.appendFileSync(out, `violation-count=${allViolations.length}\n`);
    fs.appendFileSync(out, `violations=${JSON.stringify(allViolations)}\n`);

    if (allViolations.length > 0) {
        console.error(`❌ Found ${allViolations.length} action reference(s) not pinned to a full commit SHA:`);
        for (const v of allViolations) {
            console.error(`  - ${v.file}:${v.line} uses '${v.uses}' — ${v.reason}`);
        }
        console.error("❌ Exiting because one or more uses: references are not pinned to a full 40-character commit SHA. Pin the ref (e.g. 'owner/repo@<40-char-sha>') or add the action to exclude-action-pattern if it is allowed to float.");
        process.exit(1);
    }

    console.log('✅ Exiting successfully because every scanned action reference is pinned to a full commit SHA.');
}

if (require.main === module) run();
module.exports = { run, checkFile, collectYamlFiles, isExcludedPath, parseBool, parseList };
