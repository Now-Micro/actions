#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseBool(val) {
    return /^(true|1|yes|on)$/i.test(String(val || ''));
}

function appendOutput(name, value, outFile) {
    fs.appendFileSync(outFile, `${name}=${value}\n`, { encoding: 'utf8' });
}

function ensureOutputFile() {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        throw new Error('GITHUB_OUTPUT not set');
    }
    return out;
}

function getRequiredEnv(name) {
    const v = (process.env[name] || '').trim();
    if (!v) throw new Error(`${name} is required`);
    return v;
}

function safeMkdir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function listFilesRecursive(root) {
    const files = [];
    const queue = [root];
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
            if (entry.isDirectory()) {
                queue.push(full);
            } else if (entry.isFile()) {
                files.push(full);
            }
        }
    }
    return files;
}

function copyPackages(artifactsPath, packagesPath) {
    const allFiles = fs.existsSync(artifactsPath) && fs.statSync(artifactsPath).isDirectory()
        ? listFilesRecursive(artifactsPath)
        : [];
    const matches = allFiles.filter(f => /\.(nupkg|snupkg|symbols\.nupkg)$/i.test(f));
    safeMkdir(packagesPath);
    const copied = [];
    for (const src of matches) {
        const dest = path.join(packagesPath, path.basename(src));
        fs.copyFileSync(src, dest);
        copied.push(path.basename(src));
    }
    return copied;
}

function buildReleaseNotes({ libraryName, releaseVersion, packages, changelogPath, bodyFilename }) {
    const notesPath = path.resolve(bodyFilename || 'RELEASE_NOTES.md');
    const lines = [];
    lines.push(`# ${libraryName} v${releaseVersion}`);
    lines.push('');
    lines.push('## Packages');
    if (packages.length === 0) {
        lines.push('- _No packages found_');
    } else {
        for (const pkg of packages) {
            lines.push(`- ${pkg}`);
        }
    }

    if (changelogPath) {
        lines.push('');
        lines.push('## Changelog');
        const absChange = path.isAbsolute(changelogPath) ? changelogPath : path.resolve(changelogPath);
        if (fs.existsSync(absChange) && fs.statSync(absChange).isFile()) {
            lines.push(fs.readFileSync(absChange, 'utf8'));
        } else {
            lines.push('_No changelog content found_');
        }
    }

    fs.writeFileSync(notesPath, lines.join('\n') + '\n', 'utf8');
    return notesPath;
}

function run() {
    try {
        const libraryName = getRequiredEnv('INPUT_LIBRARY_NAME');
        const releaseVersion = getRequiredEnv('INPUT_RELEASE_VERSION');
        const artifactsPath = path.resolve(process.env.INPUT_ARTIFACTS_PATH || 'release-artifacts');
        const packagesPath = path.resolve(process.env.INPUT_PACKAGES_PATH || 'release-packages');
        const changelogPath = (process.env.INPUT_CHANGELOG_PATH || '').trim();
        const tagPrefixInput = (process.env.INPUT_TAG_PREFIX || '').trim();
        const releaseNameTemplate = (process.env.INPUT_RELEASE_NAME_TEMPLATE || '{library-name} v{release-version}');
        const bodyFilename = (process.env.INPUT_BODY_FILENAME || 'RELEASE_NOTES.md').trim();
        const debugMode = parseBool(process.env.INPUT_DEBUG_MODE || 'false');

        const tagPrefix = tagPrefixInput || `${libraryName}-v`;
        const tagName = `${tagPrefix}${releaseVersion}`;
        const releaseName = releaseNameTemplate
            .replace('{library-name}', libraryName)
            .replace('{release-version}', releaseVersion);

        if (debugMode) {
            console.log(`Debug: library=${libraryName} version=${releaseVersion}`);
            console.log(`Debug: artifactsPath=${artifactsPath}`);
            console.log(`Debug: packagesPath=${packagesPath}`);
            console.log(`Debug: changelogPath=${changelogPath || '(none)'}`);
            console.log(`Debug: tagPrefix=${tagPrefix}`);
            console.log(`Debug: releaseNameTemplate=${releaseNameTemplate}`);
            console.log(`Debug: tagName=${tagName}`);
            console.log(`Debug: releaseName=${releaseName}`);
        }

        const copied = copyPackages(artifactsPath, packagesPath);
        const hasPackages = copied.length;

        if (debugMode) {
            console.log(`Debug: copied packages (${hasPackages}) = ${JSON.stringify(copied)}`);
            if (hasPackages === 0) {
                console.log('Debug: no packages found to include in the release');
            }
        }

        const notesPath = buildReleaseNotes({
            libraryName,
            releaseVersion,
            packages: copied,
            changelogPath,
            bodyFilename,
        });

        if (debugMode) {
            console.log(`Debug: release notes path = ${notesPath}`);
        }

        const outFile = ensureOutputFile();
        appendOutput('has_packages', String(hasPackages), outFile);
        appendOutput('packages_json', JSON.stringify(copied), outFile);
        appendOutput('tag_name', tagName, outFile);
        appendOutput('release_name', releaseName, outFile);
        appendOutput('release_notes_path', notesPath, outFile);
        appendOutput('packages_path', packagesPath, outFile);
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        console.error(message);
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, copyPackages, listFilesRecursive, buildReleaseNotes };
