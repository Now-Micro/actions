#!/usr/bin/env node
const { execFileSync } = require('child_process');

function log(message) {
    process.stdout.write(`${message}\n`);
}

function error(message) {
    process.stderr.write(`${message}\n`);
}

function parseBool(value) {
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes'].includes(value.toLowerCase().trim());
}

function splitCsv(value) {
    if (!value) return [];
    return value.split(',').map(item => (item ?? '').trim());
}

function zipEntries(env) {
    const names = splitCsv(env.INPUT_NAMES);
    const usernames = splitCsv(env.INPUT_USERNAMES);
    const passwords = splitCsv(env.INPUT_PASSWORDS);
    const urls = splitCsv(env.INPUT_URLS);
    const maxCount = Math.min(names.length, usernames.length, passwords.length, urls.length);
    const entries = [];

    for (let i = 0; i < maxCount; i += 1) {
        const name = names[i] || '';
        if (!name) continue;
        entries.push({
            name,
            username: usernames[i] || '',
            password: passwords[i] || '',
            url: urls[i] || '',
        });
    }

    return entries;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourceExists(listOutput, name) {
    if (!listOutput) return false;
    const pattern = new RegExp(`^\\s*\\d+\\.\\s+${escapeRegex(name)}\\b`, 'mi');
    return pattern.test(listOutput);
}

function configureSources(env = process.env, options = {}) {
    const exec = options.exec ?? execFileSync;
    const logFn = options.log ?? log;
    const debugMode = parseBool(env.INPUT_DEGUG_MODE);

    const entries = zipEntries(env);
    if (entries.length === 0) {
        logFn('No NuGet sources to configure; skipping.');
        return entries;
    }

    logFn(`Configuring ${entries.length} NuGet source(s)...`);
    for (const entry of entries) {
        logFn(`Processing NuGet source '${entry.name}' (${entry.url})`);
        const listOutput = exec('dotnet', ['nuget', 'list', 'source'], { encoding: 'utf8' });
        if (debugMode) {
            logFn('dotnet nuget list source output:');
            logFn(listOutput);
        }
        if (sourceExists(listOutput, entry.name)) {
            logFn(`NuGet source '${entry.name}' already exists. Updating...`);
            exec('dotnet', [
                'nuget',
                'update',
                'source',
                entry.name,
                '--username',
                entry.username,
                '--password',
                entry.password,
                '--store-password-in-clear-text',
            ], { encoding: 'utf8' });
        } else {
            logFn(`Adding NuGet source '${entry.name}'...`);
            exec('dotnet', [
                'nuget',
                'add',
                'source',
                '--username',
                entry.username,
                '--password',
                entry.password,
                '--store-password-in-clear-text',
                '--name',
                entry.name,
                entry.url,
            ], { encoding: 'utf8' });
        }
    }

    return entries;
}

function run(env = process.env, options = {}) {
    const exit = options.exit ?? process.exit;
    const logError = options.error ?? error;
    try {
        configureSources(env, options);
    } catch (err) {
        logError(err && err.stack ? err.stack : String(err));
        exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = {
    configureSources,
    run,
};