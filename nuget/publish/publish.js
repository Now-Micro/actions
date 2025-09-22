#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function log(msg) { process.stdout.write(`${msg}\n`); }
function error(msg) { process.stderr.write(`${msg}\n`); }

function run() {
    try {
        const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
        const actionPath = process.env.GITHUB_ACTION_PATH || __dirname;
        const pkgDir = path.join(workspace, 'nupkgs');
        const publishSource = process.env.INPUT_PUBLISH_SOURCE || '';
        const token = process.env.INPUT_GITHUB_TOKEN || '';

        if (!fs.existsSync(pkgDir)) {
            error(`nupkgs directory not found: ${pkgDir}`);
            process.exit(1);
        }

        const files = fs.readdirSync(pkgDir).filter(f => f.endsWith('.nupkg'));
        if (files.length === 0) {
            error('No .nupkg files found to publish');
            process.exit(1);
        }

        log(`Publishing packages from ${pkgDir}`);
        files.forEach(f => log(` - ${f}`));

        let target = publishSource && publishSource.trim();
        if (!target) {
            const owner = (process.env.GITHUB_REPOSITORY_OWNER || '').trim();
            if (!owner) {
                error('GITHUB_REPOSITORY_OWNER is not set and no publish-source provided');
                process.exit(1);
            }
            target = `https://nuget.pkg.github.com/${owner}/index.json`;
        }

        // Local folder publish if absolute or relative path
        const looksLocal = /^(\.|\/|[A-Za-z]:\\)/.test(target);
        if (looksLocal) {
            const dest = path.isAbsolute(target) ? target : path.join(workspace, target);
            fs.mkdirSync(dest, { recursive: true });
            for (const f of files) {
                fs.copyFileSync(path.join(pkgDir, f), path.join(dest, f));
            }
            log(`Copied ${files.length} package(s) to ${dest}`);
            return;
        }

        if (!token) {
            error('INPUT_GITHUB_TOKEN is required to push to remote source');
            process.exit(1);
        }

        // Push to remote via dotnet nuget push
        const pattern = path.join(pkgDir, '*.nupkg');
        const args = ['nuget', 'push', pattern, '--api-key', token, '--source', target];
        log(`Executing: dotnet ${args.join(' ')}`);
        const r = spawnSync('dotnet', args, { stdio: 'inherit' });
        if (r.status !== 0) {
            error(`dotnet nuget push failed with code ${r.status}`);
            process.exit(r.status || 1);
        }
        log('Push completed successfully');
    } catch (e) {
        error(e && e.stack || String(e));
        process.exit(1);
    }
}

if (require.main === module) run();
module.exports = { run };
