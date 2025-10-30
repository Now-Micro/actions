const fs = require('fs');
const os = require('os');
const path = require('path');
const child = require('child_process');

// Allow tests to inject a fake execSync
let _execSync = child.execSync;
function __setExecSync(fn) { _execSync = fn; }

function parseVersions(input) {
    if (!input) return [];
    return input.split(',').map(s => s.trim()).filter(Boolean);
}

function run() {
    const raw = process.env.INPUT_DOTNET_VERSION;
    if (!raw) {
        console.error('INPUT_DOTNET_VERSION is required');
        process.exit(1);
    }

    const versions = parseVersions(raw);
    if (versions.length === 0) {
        console.error('No versions parsed from INPUT_DOTNET_VERSION');
        process.exit(1);
    }

    const installDir = path.join(process.env.HOME || os.homedir(), '.dotnet');
    try {
        fs.mkdirSync(installDir, { recursive: true });
    } catch (e) {
        console.error('Failed creating install dir:', e.message);
        process.exit(1);
    }

    // create temporary dir for installer
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dotnet-install-'));
    try {
        // download installer once
        const installer = path.join(tmp, 'dotnet-install.sh');
        console.log(`Downloading dotnet-install to ${installer}`);
        try {
            _execSync(`curl -fsSL https://dot.net/v1/dotnet-install.sh -o "${installer}"`, { stdio: 'inherit' });
            _execSync(`chmod +x "${installer}"`, { stdio: 'inherit' });
        } catch (e) {
            console.error('Failed to download dotnet-install script:', e && e.message ? e.message : e);
            process.exit(1);
        }

        for (const rawv of versions) {
            const ver = rawv.trim();
            if (!ver) continue;
            console.log(`Installing .NET SDK: ${ver}`);
            if (ver.endsWith('.x')) {
                const channel = ver.replace(/\.x$/, '');
                console.log(`Using channel install for ${channel}`);
                _execSync(`bash "${installer}" --channel "${channel}" --install-dir "${installDir}"`, { stdio: 'inherit' });
            } else {
                _execSync(`bash "${installer}" --version "${ver}" --install-dir "${installDir}"`, { stdio: 'inherit' });
            }
        }

        // expose install dir to remaining steps
        const ghPath = process.env.GITHUB_PATH;
        if (!ghPath) {
            console.error('GITHUB_PATH not set');
            process.exit(1);
        }
        fs.appendFileSync(ghPath, `${installDir}\n`);
    } finally {
        // cleanup temp dir
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
}

if (require.main === module) run();

module.exports = { run, __setExecSync };
