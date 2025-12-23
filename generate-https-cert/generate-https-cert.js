const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function writeOutput(name, value) {
    const out = process.env.GITHUB_OUTPUT;
    fs.appendFileSync(out, `${name}=${value}\n`, { encoding: 'utf8' });
}

function run() {
    try {
        const certPath = process.env.INPUT_CERT_PATH;
        if (!certPath) {
            console.error('INPUT_CERT_PATH is required');
            process.exit(1);
        }
        const password = process.env.INPUT_CERT_PASSWORD || process.env.CERT_PASSWORD;
        const debugMode = /^(true|1|yes|on)$/i.test((process.env.INPUT_DEBUG_MODE || process.env.DEBUG_MODE || 'false').toString());
        const forceNewCert = /^(true|1|yes|on)$/i.test((process.env.INPUT_FORCE_NEW_CERT || process.env.FORCE_NEW_CERT || 'false').toString());

        if (!process.env.GITHUB_OUTPUT) {
            console.error('GITHUB_OUTPUT not set');
            process.exit(1);
        }
        if (!password) {
            console.error('CERT_PASSWORD is required');
            process.exit(1);
        }

        const cwd = process.env.INPUT_WORKSPACE_DIR || process.env.WORKSPACE_DIR || process.env.GITHUB_WORKSPACE || process.cwd();
        const fullPath = path.isAbsolute(certPath) ? certPath : path.join(cwd, certPath);

        if (debugMode) {
            console.log('Debug: certPath=', certPath);
            console.log('Debug: resolved path=', fullPath);
            console.log('Debug: working directory=', cwd);
            console.log(`Debug: will run dotnet dev-certs https -ep "${fullPath}"`);
        }

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        if (forceNewCert) {
            if (debugMode) {
                console.log('Debug: forcing clean of dev certs');
            }
            childProcess.execSync('dotnet dev-certs https --clean', { stdio: 'inherit', cwd });
        }

        const dotnetCmd = `dotnet dev-certs https -ep "${fullPath}" -p "${password}"`;
        childProcess.execSync(dotnetCmd, { stdio: 'inherit', cwd });

        try {
            fs.chmodSync(fullPath, 0o644);
        } catch (e) {
            // ignore chmod errors on platforms that don't support it
        }

        writeOutput('cert-path', certPath);
        if (debugMode) {
            console.log('Debug: outputs appended to', process.env.GITHUB_OUTPUT);
        }
        console.log(`Certificate generated: ${certPath}`);
    } catch (err) {
        console.error(err && err.message ? err.message : err);
        process.exit(1);
    }
}

module.exports = { run };

if (require.main === module) run();
