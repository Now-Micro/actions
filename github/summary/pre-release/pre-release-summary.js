'use strict';

const fs = require('node:fs');
const path = require('node:path');

function findPackages(artifactsDir) {
    if (!fs.existsSync(artifactsDir)) return [];
    const results = [];
    function walk(dir) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.nupkg')) results.push(full);
        }
    }
    walk(artifactsDir);
    return results;
}

function extractPackageInfo(filePath) {
    const fileName = path.basename(filePath);
    const baseNoExt = fileName.replace(/\.nupkg$/, '');
    const versionMatch = baseNoExt.match(/[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/);
    if (versionMatch) {
        const version = versionMatch[0];
        const packageId = baseNoExt.slice(0, baseNoExt.length - version.length - 1);
        return { fileName, packageId, version };
    }
    // Fallback: split at last dot
    const lastDot = baseNoExt.lastIndexOf('.');
    if (lastDot === -1) return { fileName, packageId: baseNoExt, version: '' };
    return {
        fileName,
        packageId: baseNoExt.slice(0, lastDot),
        version: baseNoExt.slice(lastDot + 1),
    };
}

/**
 * Parses the changed-dirs input into an array.
 * Returns null  → directory mode (input was empty; change detection was skipped).
 * Returns []    → change-detection mode, no matching directories found.
 * Returns [...] → change-detection mode, one or more directories found.
 */
function parseChangedDirs(raw) {
    if (!raw || raw.trim() === '') return null;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function buildSummary({ branch, prereleaseIdentifier, baseRef, eventName, changedDirs, repository, repositoryOwner, artifactsDir }) {
    const parsedDirs = parseChangedDirs(changedDirs);
    const lines = [];
    lines.push('# Pre-Release Build Summary');
    lines.push('');
    lines.push(`**Branch:** \`${branch}\``);
    lines.push(`**Pre-release Identifier:** \`${prereleaseIdentifier}\``);
    lines.push(`**Base Ref:** \`${baseRef}\``);
    lines.push(`**Trigger:** ${eventName}`);
    lines.push('');

    if (parsedDirs !== null && parsedDirs.length === 0) {
        lines.push('ℹ️ **No libraries with changes detected between branch and main**');
        return lines.join('\n');
    }

    lines.push('## 📦 Pre-release Packages Generated');
    lines.push('');

    const packages = findPackages(artifactsDir);
    if (packages.length === 0) {
        lines.push('No packages were generated.');
    } else {
        for (const pkgPath of packages) {
            const { fileName, packageId, version } = extractPackageInfo(pkgPath);
            lines.push(`- [\`${fileName}\`](https://github.com/${repository}/pkgs/nuget/${packageId})`);
            lines.push('  ```bash');
            lines.push(`  dotnet add package ${packageId} --version ${version} --source github`);
            lines.push('  ```');
            lines.push('');
        }
    }

    lines.push('');
    lines.push('## 📥 Installation');
    lines.push('');
    lines.push('Configure your NuGet source:');
    lines.push('```bash');
    lines.push(`dotnet nuget add source --username YOUR_USERNAME --password YOUR_PAT --store-password-in-clear-text --name github "https://nuget.pkg.github.com/${repositoryOwner}/index.json"`);
    lines.push('```');
    lines.push('');
    lines.push('Then install packages using the commands listed above for each package.');

    return lines.join('\n');
}

function run() {
    const debug = process.env.INPUT_DEBUG_MODE === 'true';
    const branch = process.env.GITHUB_REF_NAME || '';
    const prereleaseIdentifier = process.env.INPUT_PRERELEASE_IDENTIFIER || '';
    const baseRef = process.env.INPUT_BASE_REF || '';
    const eventName = process.env.GITHUB_EVENT_NAME || '';
    const changedDirs = process.env.INPUT_CHANGED_DIRS || '';
    const repository = process.env.GITHUB_REPOSITORY || '';
    const repositoryOwner = process.env.GITHUB_REPOSITORY_OWNER || '';
    const artifactsDir = process.env.INPUT_ARTIFACTS_DIR || 'prerelease-artifacts';
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;

    if (debug) {
        console.log(`🔍 Branch: ${branch}`);
        console.log(`🔍 Pre-release identifier: ${prereleaseIdentifier}`);
        console.log(`🔍 Base ref: ${baseRef}`);
        console.log(`🔍 Event name: ${eventName}`);
        console.log(`🔍 Changed dirs: ${changedDirs}`);
        console.log(`🔍 Artifacts dir: ${artifactsDir}`);
        console.log(`🔍 Repository: ${repository}`);
        console.log(`🔍 Repository owner: ${repositoryOwner}`);
    }

    if (!summaryFile) {
        console.error('❌ GITHUB_STEP_SUMMARY environment variable is not set.');
        process.exit(1);
    }

    const summary = buildSummary({ branch, prereleaseIdentifier, baseRef, eventName, changedDirs, repository, repositoryOwner, artifactsDir });
    fs.appendFileSync(summaryFile, summary + '\n');
    console.log('✅ Pre-release summary written.');
}

module.exports = { run, buildSummary, findPackages, extractPackageInfo, parseChangedDirs };
if (require.main === module) run();
