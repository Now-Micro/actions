#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function log(msg) { process.stdout.write(String(msg) + '\n'); }
function err(msg) { process.stderr.write(String(msg) + '\n'); }

function sanitize(p) {
    if (p == null) return '';
    let s = String(p).trim();
    // Remove all bracket characters anywhere in the string for robustness
    s = s.replace(/[\[\]\'\"]/g, '');
    return s;
}

function normalizeToPosix(p) {
    return sanitize(p).replace(/\\/g, '/');
}

function computeRelative(rootFile, subdirectoryFile) {
    console.log(`Relative path computation:`);

    const root = normalizeToPosix(rootFile);
    const sub = normalizeToPosix(subdirectoryFile);
    if (!root || !sub) throw new Error('Both INPUT_ROOT_FILE and INPUT_SUBDIRECTORY_FILE are required');
    if (root.includes(',')) throw new Error('INPUT_ROOT_FILE contains a comma, which is not allowed');
    if (sub.includes(',')) throw new Error('INPUT_SUBDIRECTORY_FILE contains a comma, which is not allowed');

    // Compare directories (not file-to-file) to match expected depth semantics
    const rootDir = path.posix.dirname(root);
    const subDir = path.posix.dirname(sub);

    console.log(`rootDir: ${rootDir}`);
    console.log(`subDir: ${subDir}`);
    const rel = path.posix.relative(subDir, rootDir); // e.g., '..', '../..', '../../..'
    if (!rel) return '';
    const ups = rel.split('/').filter(s => s === '..').length;
    if (ups <= 0) return '';

    const sepOut = path.sep; // platform-specific ('/' on POSIX, '\\' on Windows)
    let out = new Array(ups).fill('..').join(sepOut) + sepOut; // e.g., '../' or '..\'
    console.log(`relative path: '${out}'`);
    return out;
}

function appendGithubOutput(name, value) {
    const of = process.env.GITHUB_OUTPUT;
    if (!of) return;
    try { fs.appendFileSync(of, `${name}=${value}\n`); } catch { }
}

function run() {
    const rootFile = process.env.INPUT_ROOT_FILE || '';
    const subFile = process.env.INPUT_SUBDIRECTORY_FILE || '';
    try {
        const rel = computeRelative(rootFile, subFile);
        log(rel);
        appendGithubOutput('relative_path', rel);
    } catch (e) {
        err(e && e.message ? e.message : String(e));
        process.exit(1);
    }
}

if (require.main === module) run();

module.exports = { run, computeRelative, sanitize, normalizeToPosix };
