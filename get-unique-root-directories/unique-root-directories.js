const fs = require('fs');

function parseBool(val, def) {
    if (val === undefined || val === null) return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (["false","0","no","off"].includes(s)) return false;
    if (["true","1","yes","on"].includes(s)) return true;
    return def;
}

function run() {
    const pattern = process.env.INPUT_PATTERN;
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, true);
    const outputIsJson = parseBool(process.env.INPUT_OUTPUT_IS_JSON, true);
    const raw = process.env.INPUT_PATHS || '';
    // remove ALL occurrences of [, ], ', and " characters throughout each segment
    const dirs = raw.split(',').map(s => s.trim().replace(/["'\[\]]/g, '')).filter(Boolean)

    if (debugMode) {
        console.log(`🔍 Debug mode is ON`);
        console.log(`🔍 INPUT_PATTERN: ${pattern}`);
        console.log(`🔍 INPUT_PATHS: ${raw}`);
        console.log(`🔍 Cleaned dirs: ${dirs}`);
    }
    if (!pattern) {
        console.error('INPUT_PATTERN is required'); 
        process.exit(1);
    }
    console.log(`🔍 Getting Unique Root Directories from: ${dirs}`);
    console.log(`Using pattern: ${pattern}`);
    let re;
    try {
        re = new RegExp(pattern);
    } catch (e) {
        console.error(`Invalid regex: ${e.message}`);
        process.exit(1);
    }
    const set = new Set();
    for (const d of dirs) {
        if (debugMode) {
            console.log(`🔍 Checking if '${d}' matches the pattern...`);
        }
        const m = d.match(re);
        if (m) {
            if (debugMode) {
                console.log(`🔍 Match found: ${m}`);
            }
            if (m[1]) {
                if (!set.has(m[1])) {
                    console.log(`🔍 Unique Root Directory found: '${m[1]}'`);
                }
                set.add(m[1]);
            }
        }
    }
    const arr = [...set];
    const cleaned = arr.map(s => String(s).replace(/["'\[\]]/g, ''));
    const json = outputIsJson ? JSON.stringify(cleaned) : cleaned.join(',');
    console.log(`🔍 Unique Root Directories: ${json}`);
    const out = process.env.GITHUB_OUTPUT;
    if (!out) {
        console.error('GITHUB_OUTPUT not set');
        process.exit(1);
    }
    fs.appendFileSync(out, `unique_root_directories=${json}\n`);
}

if (require.main === module) run();
module.exports = { run };
