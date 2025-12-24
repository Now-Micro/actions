const fs = require('fs');
const path = require('path');

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
        const eventName = (process.env.INPUT_EVENT_NAME || process.env.GITHUB_EVENT_NAME || '').trim();
        const refName = (process.env.INPUT_REF_NAME || process.env.GITHUB_REF_NAME || '').trim();
        const packageInput = (process.env.INPUT_PACKAGE || '').trim();
        const versionInput = (process.env.INPUT_VERSION || '').trim();

        if (debugMode) {
            console.log('Debug: eventName=', eventName);
            console.log('Debug: refName=', refName);
            console.log('Debug: packageInput=', packageInput);
            console.log('Debug: versionInput=', versionInput);
        }

        if (!eventName) {
            console.error('INPUT_EVENT_NAME is required');
            process.exit(1);
        }

        let libraryName = '';
        let version = '';

        if (eventName === 'workflow_dispatch') {
            libraryName = packageInput;
            version = versionInput;
            if (!libraryName) {
                console.error('INPUT_PACKAGE is required for workflow_dispatch');
                process.exit(1);
            }
            if (!version) {
                console.error('INPUT_VERSION is required for workflow_dispatch');
                process.exit(1);
            }
            if (!validateVersion(version)) {
                console.error(`Invalid semantic version: ${version}`);
                process.exit(1);
            }
            if (debugMode) {
                console.log('Debug: parsed from manual inputs');
            }
        } else {
            const branch = refName;
            if (!branch) {
                console.error('INPUT_REF_NAME is required for branch parsing');
                process.exit(1);
            }
            const match = branch.match(/^release\/([^/]+)\/(.+)$/);
            if (!match) {
                console.error(`Invalid release branch name: ${branch}`);
                console.error('Expected format: release/LibraryName/X.Y.Z');
                process.exit(1);
            }
            libraryName = match[1];
            version = match[2];
            if (!validateVersion(version)) {
                console.error(`Invalid semantic version: ${version}`);
                process.exit(1);
            }
            if (debugMode) {
                console.log('Debug: parsed from branch name');
            }
        }

        appendOutput('version', version);
        appendOutput('library_name', libraryName);
        console.log('Release configuration validated successfully.');
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
