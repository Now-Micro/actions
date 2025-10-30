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

function bumpSemver(ver, type) {
    const m = ver.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return ver;
    let [_, ms, ns, ps] = m;
    let major = parseInt(ms, 10), minor = parseInt(ns, 10), patch = parseInt(ps, 10);
    switch (type) {
        case 'major':
            major += 1; minor = 0; patch = 0; break;
        case 'minor':
            minor += 1; patch = 0; break;
        case 'patch':
            patch += 1; break;
        default:
            return ver; // unknown type: no increment
    }
    return `${major}.${minor}.${patch}`;
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
    // List latest 100 releases and find the first matching keyword in name or body
    const data = await ghRequest(`/repos/${owner}/${repo}/releases?per_page=100`, token);

    console.log(`🔎 Found ${Array.isArray(data) ? data.length : 0} releases from GitHub API`);
    console.log({ data });
    if (!Array.isArray(data)) return '';
    const re = new RegExp(keyword, 'i');
    for (const r of data) {
        const name = String(r.name || '');
        const body = String(r.body || '');
        if (re.test(name) || re.test(body)) {
            // Extract a semantic version from the name, if present
            const m = name.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
            if (m) {
                console.log(`Found matching release: ${name} (${m[0]})`);
                const fromName = toBaseSemVer(m[0]);
                if (fromName) return fromName;
            }
            // Fallback: try tag_name or the entire name as a candidate
            const candidate = String(r.tag_name || '').trim() || name.trim();
            const base = toBaseSemVer(candidate);
            if (base) return base;
        }
    }
    return '';
}

async function run() {
    console.log('🔧 Starting version generation');
    const incrementType = (process.env.INPUT_INCREMENT_TYPE || 'patch').trim().toLowerCase();
    const projectFile = process.env.INPUT_PROJECT_FILE;
    const infix = (process.env.INPUT_INFIX_VALUE || '').trim();
    const releaseKeyword = (process.env.INPUT_RELEASE_KEYWORD || '').trim();
    const addTimestamp = String(process.env.INPUT_ADD_TIMESTAMP ?? 'true').toLowerCase() !== 'false';
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    console.log(`🔍 Inputs: projectFile=${projectFile || '(none)'} infix=${infix || '(none)'} releaseKeyword=${releaseKeyword || '(none)'} addTimestamp=${addTimestamp}`);

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
            console.log(`Failed to query releases: ${e.message}.  Continuing to check the project file.`);
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

    // Apply increment type if valid (major/minor/patch); otherwise leave as-is
    const effectiveVersion = bumpSemver(baseVersion, ['major', 'minor', 'patch'].includes(incrementType) ? incrementType : '');
    if (effectiveVersion !== baseVersion) {
        console.log(`🔼 Incremented version (${incrementType}): ${baseVersion} -> ${effectiveVersion}`);
    } else {
        console.log(`ℹ️ Using base version without increment: ${baseVersion}`);
    }

    // Build final version: versionNumber[-infix][-timestamp]
    const ts = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestamp = `${ts.getUTCFullYear()}${pad(ts.getUTCMonth() + 1)}${pad(ts.getUTCDate())}${pad(ts.getUTCHours())}${pad(ts.getUTCMinutes())}`;
    const parts = [effectiveVersion];
    if (infix) parts.push(infix);
    if (addTimestamp) parts.push(timestamp);
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
