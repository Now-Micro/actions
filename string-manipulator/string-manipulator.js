#!/usr/bin/env node
const fs = require('fs');

function log(msg) { process.stdout.write(`${msg}\n`); }
function error(msg) { process.stderr.write(`${msg}\n`); }

function writeOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) { throw new Error('GITHUB_OUTPUT not set'); }
    fs.appendFileSync(out, `${name}=${value}\n`);
}

function run() {
    const debug = String(process.env.INPUT_DEBUG_MODE || 'false').toLowerCase() === 'true';
    const input = process.env.INPUT_STRING || '';
    const pattern = process.env.INPUT_REGEX;
    const flagsRaw = process.env.INPUT_REGEX_FLAGS || '';
    const outputIsJson = String(process.env.INPUT_OUTPUT_IS_JSON || 'false').toLowerCase() === 'true';

    if (debug) {
        log('🔍 Debug mode is ON');
        log(`🔍 INPUT_STRING: ${input.length > 120 ? input.slice(0, 120) + '…' : input}`);
        log(`🔍 INPUT_REGEX: ${pattern}`);
        log(`🔍 INPUT_REGEX_FLAGS: ${flagsRaw}`);
    }

    if (!pattern) {
        error('INPUT_REGEX is required');
        process.exit(1);
    }
    if (!process.env.GITHUB_OUTPUT) {
        error('GITHUB_OUTPUT not set');
        process.exit(1);
    }

    // Ensure we always include 'g' for global matching
    const flags = (flagsRaw || '').includes('g') ? flagsRaw : `${flagsRaw}g`;
    let re;
    try {
        re = new RegExp(pattern, flags);
    } catch (e) {
        error(`Invalid regex: ${e.message}`);
        process.exit(1);
    }

    // Validate that the pattern includes a capturing group
    // Quick heuristic: presence of '(' not followed by '?:' or lookaround-only. We allow any group but we will use group 1.
    if (!/(^|[^\\])\(/.test(pattern)) {
        error('Pattern must include a capturing group (e.g., (…))');
        process.exit(1);
    }

    const matches = [];
    let m;
    while ((m = re.exec(input)) !== null) {
        // Protect against zero-width loops
        if (m.index === re.lastIndex) re.lastIndex++;
        const g1 = m[1] !== undefined ? m[1] : '';
        if (debug) log(`🔍 Match: ${JSON.stringify(m[0])} | group1: ${JSON.stringify(g1)}`);
        matches.push(g1);
    }

    const output = outputIsJson ? JSON.stringify(matches) : matches.join(',');
    if (debug) log(`🔍 Matches: ${output}`);
    writeOutput('matches', output);
}

if (require.main === module) {
    try { run(); } catch (e) { error(e && e.stack || String(e)); process.exit(1); }
}
module.exports = { run };
