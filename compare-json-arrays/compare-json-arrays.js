const fs = require('fs');

function parseBool(val, def) {
    if (val === undefined || val === null) return def;
    if (typeof val === 'boolean') return val;
    const s = String(val).trim().toLowerCase();
    if (['false', '0', 'no', 'off'].includes(s)) return false;
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    return def;
}

function parseArray(raw, name) {
    if (!raw || raw.trim() === '') {
        console.error(`${name} is required and must not be empty. Pass "[]" for an empty array.`);
        process.exit(1);
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            console.error(`${name} must be a JSON array, got: ${raw}`);
            process.exit(1);
        }
        return parsed;
    } catch (e) {
        console.error(`Failed to parse ${name} as JSON: ${e.message}`);
        process.exit(1);
    }
}

function run() {
    const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
    const mode = (process.env.INPUT_MODE || '').trim().toLowerCase();
    const rawA = process.env.INPUT_ARRAY_A || '';
    const rawB = process.env.INPUT_ARRAY_B || '';
    const outputFile = process.env.GITHUB_OUTPUT;

    if (!outputFile) {
        console.error('GITHUB_OUTPUT not set');
        process.exit(1);
    }

    const validModes = ['intersection', 'union', 'left-diff', 'right-diff', 'unique'];
    if (!validModes.includes(mode)) {
        console.error(`INPUT_MODE must be one of: ${validModes.join(', ')}. Got: '${mode}'`);
        process.exit(1);
    }

    const arrayA = parseArray(rawA, 'INPUT_ARRAY_A');
    const arrayB = parseArray(rawB, 'INPUT_ARRAY_B');

    if (debugMode) {
        console.log(`🔍 Debug mode is ON`);
        console.log(`🔍 Mode: ${mode}`);
        console.log(`🔍 Array A (${arrayA.length} items): ${JSON.stringify(arrayA)}`);
        console.log(`🔍 Array B (${arrayB.length} items): ${JSON.stringify(arrayB)}`);
    }

    let result;
    const setB = new Set(arrayB);
    const setA = new Set(arrayA);

    switch (mode) {
        case 'intersection':
            result = arrayA.filter(x => setB.has(x));
            break;
        case 'union': {
            const seen = new Set();
            result = [];
            for (const x of [...arrayA, ...arrayB]) {
                if (!seen.has(x)) {
                    seen.add(x);
                    result.push(x);
                }
            }
            break;
        }
        case 'left-diff':
            result = arrayA.filter(x => !setB.has(x));
            break;
        case 'right-diff':
            result = arrayB.filter(x => !setA.has(x));
            break;
        case 'unique':
            result = [
                ...arrayA.filter(x => !setB.has(x)),
                ...arrayB.filter(x => !setA.has(x)),
            ];
            break;
    }

    const json = JSON.stringify(result);
    if (debugMode) {
        console.log(`🔍 Result (${result.length} items): ${json}`);
    } else {
        console.log(`Result: ${result.length} item(s)`);
    }

    fs.appendFileSync(outputFile, `result=${json}\n`);
}

if (require.main === module) run();

module.exports = { run };
