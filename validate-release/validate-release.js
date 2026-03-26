const fs = require('fs');
const path = require('path');

function parseBool(val, def = false) {
    if (val === undefined || val === null || val === '') return def;
    const s = String(val).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    return def;
}

function ensureOutputFile() {
    const outFile = process.env.GITHUB_OUTPUT;
    if (!outFile) {
        throw new Error('GITHUB_OUTPUT not set');
    }
    return outFile;
}

function appendOutput(name, value) {
    fs.appendFileSync(ensureOutputFile(), `${name}=${value}\n`, { encoding: 'utf8' });
}

function escapeRegexLiteral(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(p) {
    return path.resolve(p).split(path.sep).join('/');
}

function validateVersion(version) {
    return /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version);
}

function resolveWorkingDirectory() {
    const raw = (process.env.INPUT_WORKING_DIRECTORY || process.env.GITHUB_WORKSPACE || process.cwd()).trim();
    return path.isAbsolute(raw) ? raw : path.resolve(raw);
}

function parseReleaseConfiguration(packageInput, versionInput, refName) {
    if (packageInput && versionInput) {
        if (!validateVersion(versionInput)) {
            throw new Error(`Invalid semantic version: ${versionInput}`);
        }
        return { libraryName: packageInput, version: versionInput, source: 'manual inputs' };
    }

    const match = refName.match(/^release\/([^/]+)\/(.+)$/);
    if (!match) {
        throw new Error('Ref does not match release/* and package/version inputs are missing or incomplete');
    }

    const libraryName = match[1];
    const version = match[2];
    if (!validateVersion(version)) {
        throw new Error(`Invalid semantic version: ${version}`);
    }

    return { libraryName, version, source: 'ref name' };
}

function findProjectFiles(rootDir, libraryName, debugMode) {
    const target = new RegExp(`^${escapeRegexLiteral(libraryName)}\\.csproj$`);
    const queue = [rootDir];
    const matches = [];

    while (queue.length) {
        const current = queue.shift();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (err) {
            if (debugMode) {
                console.log(`🔍 Skipping unreadable directory: ${current} (${err.message})`);
            }
            continue;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));

        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isFile() && target.test(entry.name)) {
                matches.push(full);
                if (debugMode) {
                    console.log(`🔍 Matched project file: ${full}`);
                }
            }
        }

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== '.git' && entry.name !== 'node_modules') {
                queue.push(path.join(current, entry.name));
            }
        }
    }

    return matches;
}

function run() {
    try {
        const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
        const packageInput = (process.env.INPUT_PACKAGE || '').trim();
        const versionInput = (process.env.INPUT_VERSION || '').trim();
        const refName = (process.env.INPUT_REF_NAME || process.env.GITHUB_REF_NAME || '').trim();
        const workingDirectory = resolveWorkingDirectory();

        if (debugMode) {
            console.log('🔍 Debug mode is ON');
            console.log(`🔍 INPUT_PACKAGE: ${packageInput}`);
            console.log(`🔍 INPUT_VERSION: ${versionInput}`);
            console.log(`🔍 INPUT_REF_NAME: ${refName}`);
            console.log(`🔍 INPUT_WORKING_DIRECTORY: ${workingDirectory}`);
        }

        if (!fs.existsSync(workingDirectory) || !fs.statSync(workingDirectory).isDirectory()) {
            console.error(`Working directory does not exist or is not a directory: ${workingDirectory}`);
            process.exit(1);
        }

        const { libraryName, version, source } = parseReleaseConfiguration(packageInput, versionInput, refName);

        if (debugMode) {
            console.log(`🔍 Parsed release configuration from ${source}`);
        }

        const matches = findProjectFiles(workingDirectory, libraryName, debugMode);
        if (matches.length === 0) {
            console.error(`No project found for package ${libraryName}`);
            process.exit(1);
        }
        if (matches.length > 1) {
            console.error(`Multiple projects found for package ${libraryName}:`);
            for (const match of matches) {
                console.error(normalizePath(path.dirname(match)));
            }
            process.exit(1);
        }

        const projectDir = normalizePath(path.dirname(matches[0]));
        appendOutput('version', version);
        appendOutput('library_name', libraryName);
        appendOutput('path_to_project', projectDir);

        if (debugMode) {
            console.log(`🔍 path_to_project: ${projectDir}`);
            console.log('🔍 Release configuration validated successfully.');
        }
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(message);
        process.exit(1);
    }
}

if (require.main === module) run();
module.exports = { run, parseReleaseConfiguration, findProjectFiles, validateVersion };