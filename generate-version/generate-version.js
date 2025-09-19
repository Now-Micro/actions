#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

function exitWith(msg) {
    console.error(`❌ ${msg}`);
    process.exit(1);
}

function isSemVer(v) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(v);
}

function toBaseSemVer(v) {
    if (!v) return '';
    // Trim CRLF/whitespace
    v = String(v).replace(/\r/g, '').trim();
    // If four-part like 1.2.3.4, reduce to 1.2.3
    const m4 = v.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
    if (m4) v = m4[1];
    // Strip pre-release suffix if present
    v = v.replace(/-.*/, '');
    if (!/^\d+\.\d+\.\d+$/.test(v)) return '';
    return v;
}

function readCsprojVersion(file) {
    const xml = fs.readFileSync(file, 'utf8');
    const mVer = xml.match(/<Version>([^<]+)<\/Version>/);
    if (mVer) return toBaseSemVer(mVer[1]);
    const mPrefix = xml.match(/<VersionPrefix>([^<]+)<\/VersionPrefix>/);
    if (mPrefix) return toBaseSemVer(mPrefix[1]);
    return '0.0.1';
}

function ghRequest(pathname, token) {
    const opts = {
        hostname: 'api.github.com',
        method: 'GET',
        path: pathname,
        headers: {
            'User-Agent': 'now-micro-actions/version-generator',
            'Accept': 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    };
    return new Promise((resolve, reject) => {
        const req = https.request(opts, res => {
            let buf = '';
            res.on('data', d => (buf += d));
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try { resolve(JSON.parse(buf)); } catch { resolve({}); }
                } else if (res.statusCode === 404) {
                    resolve(null);
                } else {
                    reject(new Error(`GitHub API ${res.statusCode}: ${buf}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function findReleaseVersionByKeyword(owner, repo, keyword, token) {
    // List latest 100 releases and find the first matching keyword
    const data = await ghRequest(`/repos/${owner}/${repo}/releases?per_page=100`, token);
    if (!Array.isArray(data)) return '';
    const re = new RegExp(keyword, 'i');
    for (const r of data) {
        const name = r.name || r.tag_name || '';
        if (re.test(name)) {
            // Prefer tag_name as semver source
            const candidate = String(r.tag_name || '').trim() || String(r.name || '').trim();
            const base = toBaseSemVer(candidate);
            if (base) return base;
        }
    }
    return '';
}

async function run() {
    console.log('🔧 Starting version generation');
    const projectFile = process.env.INPUT_PROJECT_FILE;
    const infix = (process.env.INPUT_INFIX_VALUE || '').trim();
    const releaseKeyword = (process.env.INPUT_RELEASE_KEYWORD || '').trim();
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    console.log(`🔍 Inputs: projectFile=${projectFile || '(none)'} infix=${infix || '(none)'} releaseKeyword=${releaseKeyword || '(none)'} `);

    if (!projectFile && !releaseKeyword) {
        exitWith('INPUT_PROJECT_FILE is required when release-keyword is not provided');
    }

    let baseVersion = '';

    if (releaseKeyword) {
        const repoFull = process.env.GITHUB_REPOSITORY || '';
        const [owner, repo] = repoFull.split('/');
        if (!owner || !repo) exitWith('GITHUB_REPOSITORY not set');
        try {
            console.log(`🔎 Searching releases in ${owner}/${repo} for keyword: ${releaseKeyword}`);
            baseVersion = await findReleaseVersionByKeyword(owner, repo, releaseKeyword, token);
            if (baseVersion) {
                console.log(`📦 Found release base version: ${baseVersion}`);
            } else {
                console.log('ℹ️ No matching release found, will fall back to project file if provided.');
            }
        } catch (e) {
            exitWith(`Failed to query releases: ${e.message}`);
        }
    }

    if (!baseVersion) {
        if (!projectFile) exitWith('INPUT_PROJECT_FILE is required to read version from csproj');
        const abs = path.isAbsolute(projectFile) ? projectFile : path.join(process.cwd(), projectFile);
        if (!fs.existsSync(abs)) exitWith(`Project file not found: ${abs}`);
        try {
            console.log(`📄 Reading version from project file: ${abs}`);
            baseVersion = readCsprojVersion(abs);
            console.log(`📌 Project file base version: ${baseVersion || '(empty)'}`);
        } catch (e) {
            exitWith(`Failed to read project file: ${e.message}`);
        }
    }

    if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
        exitWith(`Invalid semantic base version: ${baseVersion}`);
    }

    // Build final version: versionNumber-infix-timestamp
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}`;
    const parts = [baseVersion];
    if (infix) parts.push(infix);
    parts.push(timestamp);
    const version = parts.join('-');

    // Output
    const out = process.env.GITHUB_OUTPUT;
    if (!out) exitWith('GITHUB_OUTPUT not set');
    fs.appendFileSync(out, `version_number=${version}\n`);
    console.log(`✅ Version: ${version}`);
}

if (require.main === module) {
    run().catch(e => exitWith(e.message));
}

module.exports = { run, isSemVer, toBaseSemVer };
