const fs = require('fs');

function appendOutput(name, value) {
    const outFile = process.env.GITHUB_OUTPUT;
    if (!outFile) {
        throw new Error('GITHUB_OUTPUT not set');
    }
    fs.appendFileSync(outFile, `${name}=${value}\n`, { encoding: 'utf8' });
}

function parseBool(val) {
    return /^(true|1|yes|on)$/i.test((val || '').toString());
}

function validateVersion(version) {
    const pattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
    return pattern.test(version);
}

function run() {
    try {
        const debugMode = parseBool(process.env.INPUT_DEBUG_MODE || process.env.DEBUG_MODE || 'false');
        const refName = (process.env.INPUT_REF_NAME || process.env.GITHUB_REF_NAME || '').trim();
        const packageInput = (process.env.INPUT_PACKAGE || '').trim();
        const versionInput = (process.env.INPUT_VERSION || '').trim();

        if (debugMode) {
            console.log('Debug: refName=', refName);
            console.log('Debug: packageInput=', packageInput);
            console.log('Debug: versionInput=', versionInput);
        }

        let libraryName = '';
        let version = '';

        const branch = refName;
        const branchMatch = branch && branch.match(/^release\/([^/]+)\/(.+)$/);
        if (branchMatch) {
            libraryName = branchMatch[1];
            version = branchMatch[2];
            if (!validateVersion(version)) {
                console.error(`Invalid semantic version: ${version}`);
                process.exit(1);
            }
            if (debugMode) {
                console.log('Debug: parsed from branch name');
            }
        } else {
            libraryName = packageInput;
            version = versionInput;
            if (!libraryName) {
                console.error('INPUT_PACKAGE is required when ref does not match release/*');
                process.exit(1);
            }
            if (!version) {
                console.error('INPUT_VERSION is required when ref does not match release/*');
                process.exit(1);
            }
            if (!validateVersion(version)) {
                console.error(`Invalid semantic version: ${version}`);
                process.exit(1);
            }
            if (debugMode) {
                console.log('Debug: parsed from manual inputs');
            }
        }

        appendOutput('version', version);
        appendOutput('library_name', libraryName);
        if (debugMode) {
            console.log('Debug: outputs appended to', process.env.GITHUB_OUTPUT);
            console.log('Release configuration validated successfully.');
        }
    } catch (err) {
        const message = err && err.message ? err.message : err;
        console.error(message);
        process.exit(1);
    }
}

module.exports = { run };

if (require.main === module) {
    run();
}
