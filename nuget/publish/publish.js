#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function log(msg) { process.stdout.write(`${msg}\n`); }
function error(msg) { process.stderr.write(`${msg}\n`); }
function maskToken(t) { if (!t) return ''; return `${t.slice(0, 3)}…${t.slice(-3)}`; }

function run() {
    try {
        const workspace = process.env.GITHUB_WORKSPACE || process.cwd();
        const actionPath = process.env.GITHUB_ACTION_PATH || __dirname;
        const pkgDir = path.join(workspace, 'nupkgs');
        const publishSource = process.env.INPUT_PUBLISH_SOURCE || '';
        const token = process.env.INPUT_GITHUB_TOKEN || '';

        // Session header (ASCII only for log stability)
        log('nuget/publish starting');
        log(`Node: ${process.version} | PID: ${process.pid}`);
        log(`workspace: ${workspace}`);
        log(`actionPath: ${actionPath}`);
        log(`pkgDir: ${pkgDir}`);
        log(`publishSource (raw): ${publishSource || '(empty)'}`);

        const allEntries = fs.readdirSync(pkgDir);
        log(`entries in pkgDir: ${allEntries.length}`);
        const files = allEntries.filter(f => f.endsWith('.nupkg'));
        log(`nupkg files detected: ${files.length}`);
        if (files.length === 0) {
            error('No .nupkg files found to publish');
            process.exit(1);
        }

        log('Package list:');
        files.forEach(f => log(`   - ${f}`));

        let target = publishSource && publishSource.trim();
        if (!target) {
            const owner = (process.env.GITHUB_REPOSITORY_OWNER || '').trim();
            log(`no publish-source provided; owner: ${owner || '(missing)'}`);
            if (!owner) {
                error('GITHUB_REPOSITORY_OWNER is not set and no publish-source provided');
                process.exit(1);
            }
            target = `https://nuget.pkg.github.com/${owner}/index.json`;
        }
        log(`resolved target: ${target}`);

        // Local folder publish if absolute or relative path
        const looksLocal = /^(\.|\/|[A-Za-z]:\\)/.test(target);
        log(`looksLocal: ${looksLocal}`);
        if (looksLocal) {
            const dest = path.isAbsolute(target) ? target : path.join(workspace, target);
            log(`Local publish to: ${dest}`);
            fs.mkdirSync(dest, { recursive: true });
            for (const f of files) {
                const from = path.join(pkgDir, f);
                const to = path.join(dest, f);
                log(`   copy ${from} -> ${to}`);
                fs.copyFileSync(from, to);
            }
            log(`Copied ${files.length} package(s) to ${dest}`);
            log(`Done in ${Date.now() - t0} ms`);
            return;
        }

        if (!token) {
            error('INPUT_GITHUB_TOKEN is required to push to remote source');
            process.exit(1);
        }

        // Push to remote via dotnet nuget push
        const pattern = path.join(pkgDir, '*.nupkg');
        const args = ['nuget', 'push', pattern, '--api-key', token, '--source', target];
        log(`Remote publish using dotnet`);
        log(`   pattern: ${pattern}`);
        log(`   source: ${target}`);
        log(`   api-key: ${maskToken(token)}`);
        log(`   command: dotnet ${args.join(' ')}`);
        const r = spawnSync('dotnet', args, { stdio: 'inherit' });
        if (r.status !== 0) {
            error(`dotnet nuget push failed with code ${r.status}`);
            process.exit(r.status || 1);
        }
        log('Push completed successfully');
        log(`Done in ${Date.now() - t0} ms`);
    } catch (e) {
        error(e && e.stack || String(e));
        process.exit(1);
    }
}

if (require.main === module) run();
module.exports = { run };
