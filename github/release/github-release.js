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

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractChangelogSection(content, releaseVersion, debugMode = false) {
    if (!content || !releaseVersion) return content || '';
    const patternSource = `^##\\s*\\[?v?${escapeRegex(releaseVersion)}\\]?[^\\n]*$`;
    const pattern = new RegExp(patternSource, 'mi');
    if (debugMode) {
        console.log(`Debug: extractChangelogSection version=${releaseVersion}`);
        console.log(`Debug: pattern=${patternSource}`);
    }
    const match = content.match(pattern);
    if (!match || match.index === undefined) {
        if (debugMode) {
            console.log('Debug: no changelog match found; returning full content');
        }
        return content.trim();
    }
    const start = match.index;
    const remainder = content.slice(start);
    const afterCurrent = remainder.slice(match[0].length);
    const nextHeadingRel = afterCurrent.search(/^##\s*\[/m);
    const slice = nextHeadingRel >= 0 ? remainder.slice(0, match[0].length + nextHeadingRel) : remainder;
    if (debugMode) {
        console.log(`Debug: changelog section start=${start} length=${slice.length}`);
        console.log(`Debug: matched heading='${match[0].trim()}'`);
        if (nextHeadingRel >= 0) {
            console.log(`Debug: next heading relative offset=${nextHeadingRel}`);
        } else {
            console.log('Debug: no subsequent heading found; using remainder');
        }
    }
    return slice.trim();
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

function buildReleaseNotes({ libraryName, releaseVersion, packages, changelogPath, bodyFilename, debugMode = false }) {
    const notesPath = path.resolve(bodyFilename || 'RELEASE_NOTES.md');
    const repo = process.env.GITHUB_REPOSITORY || '';
    const owner = repo.includes('/') ? repo.split('/')[0] : (repo || 'your-org');
    const nugetFeed = `https://nuget.pkg.github.com/${owner}/index.json`;

    const lines = [];
    lines.push(`# ${libraryName} v${releaseVersion}`);
    lines.push('');

    lines.push('## Library Release');
    lines.push(`This is a targeted release for ${libraryName} version ${releaseVersion}.`);
    lines.push('');

    lines.push('## Installation');
    lines.push('```');
    lines.push(`dotnet add package ${libraryName} --version ${releaseVersion}`);
    lines.push('```');
    lines.push('');

    lines.push('## Package Details');
    if (packages.length === 0) {
        lines.push('- No packages found');
    } else {
        for (const pkg of packages) {
            lines.push(`- ${pkg}`);
        }
    }
    lines.push('');

    lines.push('## Updates');
    const absChange = changelogPath && (path.isAbsolute(changelogPath) ? changelogPath : path.resolve(changelogPath));
    if (debugMode) {
        console.log(`Debug: changelog resolved path=${absChange || '(none)'}`);
    }
    if (absChange && fs.existsSync(absChange) && fs.statSync(absChange).isFile()) {
        const changelogContent = fs.readFileSync(absChange, 'utf8').trim();
        const versionSection = extractChangelogSection(changelogContent, releaseVersion, debugMode).trim();
        if (versionSection) {
            lines.push(versionSection);
        } else {
            lines.push('No changelog content found');
        }
    } else {
        lines.push('No changelog content found');
    }
    lines.push('');

    lines.push('## Installation via GitHub Packages');
    lines.push('Configure your NuGet source:');
    lines.push('```');
    lines.push('dotnet nuget add source --username YOUR_USERNAME --password YOUR_PAT --store-password-in-clear-text --name github "' + nugetFeed + '"');
    lines.push('```');

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
            console.log(`Debug: bodyFilename=${bodyFilename}`);
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
            debugMode,
        });

        if (debugMode) {
            console.log(`Debug: release notes path = ${notesPath}`);
            console.log(`Debug: has_packages=${hasPackages} tag=${tagName} release=${releaseName}`);
        }

        const outFile = ensureOutputFile();
        appendOutput('has_packages', String(hasPackages), outFile);
        appendOutput('packages_json', JSON.stringify(copied), outFile);
        appendOutput('tag_name', tagName, outFile);
        appendOutput('release_name', releaseName, outFile);
        appendOutput('release_notes_path', notesPath, outFile);
        appendOutput('packages_path', packagesPath, outFile);

        if (debugMode) {
            console.log(`Debug: outputs written to ${outFile}`);
        }
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
