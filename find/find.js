const fs = require('fs');
const path = require('path');

function parseBool(val) {
    return /^(true|1|yes|on)$/i.test(String(val || ''));
}

function ensureOutputFile() {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        throw new Error('GITHUB_OUTPUT not set');
    }
    return out;
}

function escapeRegexLiteral(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPattern(input) {
    if (!input) {
        throw new Error('INPUT_REGEX is required');
    }
    const looksLikeRegex = /[\[\]{}()*+?|^$\\]/.test(input);
    const source = looksLikeRegex ? input : `^${escapeRegexLiteral(input)}$`;
    let pattern;
    try {
        pattern = new RegExp(source);
    } catch (e) {
        throw new Error(`Invalid regex: ${e.message}`);
    }
    return pattern;
}

function normalizeRelative(base, target) {
    const rel = path.relative(base, target) || '.';
    return rel.split(path.sep).join('/');
}

function normalizeAbsolute(p) {
    return path.resolve(p).split(path.sep).join('/');
}

function findMatches(rootDir, regex, debugMode) {
    const matches = [];
    const dirs = [];
    const queue = [rootDir];

    while (queue.length) {
        const dir = queue.shift();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            console.error(`Cannot read directory: ${dir} (${e.message})`);
            continue;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isFile()) {
                if (regex.test(entry.name)) {
                    matches.push(full);
                    dirs.push(path.dirname(full));
                    if (debugMode) console.log(`Matched file: ${full}`);
                }
            }
        }

        for (const entry of entries) {
            if (entry.isDirectory()) {
                queue.push(path.join(dir, entry.name));
            }
        }
    }

    return { matches, dirs };
}

function appendOutput(name, value, outFile) {
    fs.appendFileSync(outFile, `${name}=${value}\n`, { encoding: 'utf8' });
}

function run() {
    try {
        const debugMode = parseBool(process.env.INPUT_DEBUG_MODE || process.env.DEBUG_MODE || 'false');
        const workingDirRaw = (process.env.INPUT_WORKING_DIRECTORY || process.cwd()).trim();
        const workingDir = path.isAbsolute(workingDirRaw) ? workingDirRaw : path.resolve(workingDirRaw);
        const regexInput = (process.env.INPUT_REGEX || '').trim();

        if (debugMode) {
            console.log('Debug: working-directory =', workingDir);
            console.log('Debug: regex input =', regexInput);
        }

        if (!regexInput) {
            console.error('INPUT_REGEX is required');
            process.exit(1);
        }

        if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
            console.error(`Working directory does not exist or is not a directory: ${workingDir}`);
            process.exit(1);
        }

        let pattern;
        try {
            pattern = buildPattern(regexInput);
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }

        const { matches, dirs } = findMatches(workingDir, pattern, debugMode);

        const matchedFiles = matches.map(p => path.basename(p));
        const matchedDirsRelativeRaw = dirs.map(d => normalizeRelative(workingDir, d));
        const matchedDirsRelative = matchedDirsRelativeRaw.map(d => d === '.' ? './' : `./${d}`);
        const matchedDirsAbsolute = dirs.map(d => normalizeAbsolute(d));

        if (debugMode) {
            console.log('Debug: matched files =', JSON.stringify(matchedFiles));
            console.log('Debug: matched dirs (relative) =', JSON.stringify(matchedDirsRelative));
            console.log('Debug: matched dirs (absolute) =', JSON.stringify(matchedDirsAbsolute));
        }

        let outFile;
        try {
            outFile = ensureOutputFile();
        } catch (err) {
            console.error(err.message);
            process.exit(1);
        }

        appendOutput('matched-files', JSON.stringify(matchedFiles), outFile);
        appendOutput('matched-dirs-relative', JSON.stringify(matchedDirsRelative), outFile);
        appendOutput('matched-dirs-absolute', JSON.stringify(matchedDirsAbsolute), outFile);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(message);
        process.exit(1);
    }
}

module.exports = { run, buildPattern, findMatches, normalizeRelative };

if (require.main === module) {
    run();
}
