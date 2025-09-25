#!/usr/bin/env node
const fs = require('fs');

function log(msg) { process.stdout.write(`${msg}\n`); }
function error(msg) { process.stderr.write(`${msg}\n`); }

function writeOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    if (!out) { throw new Error('GITHUB_OUTPUT not set'); }
    fs.appendFileSync(out, `${name}=${value}\n`);
}

function toBool(v, dflt = false) {
    if (v === undefined || v === null || v === '') return dflt;
    const s = String(v).toLowerCase();
    return s === 'true' || s === '1' || s === 'yes';
}

function applyReplacements(input, replacementRaw, debug = false) {
    let steps;
    try {
        steps = JSON.parse(replacementRaw);
    } catch (e) {
        throw new Error(`Invalid replacement JSON: ${e.message}`);
    }
    if (!Array.isArray(steps)) {
        throw new Error('Replacement must be a JSON array of tuples');
    }
    let replaced = input;
    for (let i = 0; i < steps.length; i++) {
        const t = steps[i];
        if (!Array.isArray(t) || t.length < 2) {
            throw new Error(`Replacement tuple at index ${i} must be [pattern, replacement, flags?]`);
        }
        let pat = t[0];
        const rep = t[1];
        let fl = t[2] || '';
        if (typeof pat !== 'string' || typeof rep !== 'string') {
            throw new Error(`Replacement tuple at index ${i} must have string pattern and replacement`);
        }
        // Allow '/.../' form; strip leading and trailing slash if present
        if (pat.length >= 2 && pat[0] === '/' && pat.lastIndexOf('/') === pat.length - 1) {
            pat = pat.slice(1, -1);
        }
        // Always include 'g' for global replacement
        fl = (fl || '').includes('g') ? fl : `${fl}g`;
        let reStep;
        try {
            reStep = new RegExp(pat, fl);
        } catch (e) {
            throw new Error(`Invalid replacement regex at index ${i}: ${e.message}`);
        }
        const before = replaced;
        replaced = replaced.replace(reStep, rep);
        if (debug) {
            const bPrev = before.length > 120 ? before.slice(0, 120) + '…' : before;
            const aPrev = replaced.length > 120 ? replaced.slice(0, 120) + '…' : replaced;
            log(`🔧 Step ${i}: /${pat}/${fl} -> ${JSON.stringify(rep)} | ${JSON.stringify(bPrev)} => ${JSON.stringify(aPrev)}`);
        }
    }
    if (debug) {
        const prev = input.length > 120 ? input.slice(0, 120) + '…' : input;
        const next = replaced.length > 120 ? replaced.slice(0, 120) + '…' : replaced;
        log(`🔧 Replace preview: ${JSON.stringify(prev)} -> ${JSON.stringify(next)}`);
    }
    return replaced;
}

function run() {
    const debug = toBool(process.env.INPUT_DEBUG_MODE, false);
    const input = process.env.INPUT_STRING || '';
    const pattern = process.env.INPUT_REGEX;
    const flagsRaw = process.env.INPUT_REGEX_FLAGS || '';
    const outputIsJson = toBool(process.env.INPUT_OUTPUT_IS_JSON, false);
    const replacement = process.env.INPUT_REPLACEMENT !== undefined ? process.env.INPUT_REPLACEMENT : '';

    if (debug) {
        log('🔍 Debug mode is ON');
        log(`🔍 INPUT_STRING: ${input.length > 120 ? input.slice(0, 120) + '…' : input}`);
        log(`🔍 INPUT_REGEX: ${pattern}`);
        log(`🔍 INPUT_REGEX_FLAGS: ${flagsRaw}`);
        if (replacement) log(`🔍 INPUT_REPLACEMENT: ${replacement.length > 120 ? replacement.slice(0, 120) + '…' : replacement}`);
    }

    // Determine if we'll write any outputs
    const doMatch = !!pattern;
    const doReplace = !!replacement;
    // Only require GITHUB_OUTPUT if we are going to write outputs
    if ((doMatch || doReplace) && !process.env.GITHUB_OUTPUT) {
        error('GITHUB_OUTPUT not set');
        process.exit(1);
    }
    if ((doMatch || doReplace) && !input) {
        error('INPUT_STRING not set.  Please provide a string to process.');
        process.exit(1);
    }

    let regexFactory = null;
    let flags = '';
    if (doMatch) {
        // Ensure we always include 'g' for global operations
        flags = (flagsRaw || '').includes('g') ? flagsRaw : `${flagsRaw}g`;
        try {
            // Use a factory to create fresh regex objects to avoid lastIndex interference
            regexFactory = () => new RegExp(pattern, flags);
            // Smoke test construction
            regexFactory();
        } catch (e) {
            error(`Invalid regex: ${e.message}`);
            process.exit(1);
        }
    }

    if (doMatch) {
        // Validate that the pattern includes a capturing group for matching mode
        if (!/(^|[^\\])\(/.test(pattern)) {
            error('Pattern must include a capturing group (e.g., (…))');
            process.exit(1);
        }
        const re = regexFactory();
        const matches = [];
        const allGroups = [];
        let m;
        while ((m = re.exec(input)) !== null) {
            if (m.index === re.lastIndex) re.lastIndex++;
            const g1 = m[1] !== undefined ? m[1] : '';
            const groups = [];
            for (let i = 1; i < m.length; i++) groups.push(m[i] !== undefined ? m[i] : '');
            if (debug) log(`🔍 Match: ${JSON.stringify(m[0])} | groups: ${JSON.stringify(groups)}`);
            matches.push(g1);
            allGroups.push(groups);
        }
        const output = outputIsJson ? JSON.stringify(matches) : matches.join(',');
        if (debug) log(`🔍 Matches: ${output}`);
        writeOutput('matches', output);
        const allGroupsJson = JSON.stringify(allGroups);
        if (debug) log(`🔍 All groups: ${allGroupsJson}`);
        writeOutput('matches_all_groups', allGroupsJson);
    }

    if (doReplace) {
        try {
            const replaced = applyReplacements(input, replacement, debug);
            writeOutput('replaced', replaced);
        } catch (e) {
            error(e && e.message ? e.message : String(e));
            process.exit(1);
        }
    }

    // If nothing to do (no regex and no replacement), exit 0 silently
    return;
}

if (require.main === module) {
    try { run(); } catch (e) { error(e && e.stack || String(e)); process.exit(1); }
}
module.exports = { run, applyReplacements };
