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

function parseRegisteredSources(listOutput) {
    const entries = [];
    if (!listOutput) return entries;
    const lines = listOutput.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
        const match = lines[i].match(/^\s*\d+\.\s+([^\[]+)/);
        if (!match) continue;
        const name = match[1].trim();
        let url = '';
        if (i + 1 < lines.length) {
            const candidate = lines[i + 1].trim();
            if (candidate.startsWith('http')) {
                url = candidate;
            }
        }
        entries.push({ name, url });
    }
    return entries;
}

function runDotnet(exec, args, logFn, debugMode) {
    if (debugMode) {
        logFn(`exec: dotnet ${args.join(' ')}`);
    }
    return exec('dotnet', args, { encoding: 'utf8' });
}

function configureSources(env = process.env, options = {}) {
    const exec = options.exec ?? execFileSync;
    const logFn = options.log ?? log;
    const debugMode = parseBool(env.INPUT_DEGUG_MODE);

    const entries = zipEntries(env);
    if (debugMode) {
        logFn('🔍 Inputs after validation:');
        logFn(`  names: ${env.INPUT_NAMES}`);
        logFn(`  usernames: ${env.INPUT_USERNAMES}`);
        logFn(`  passwords: ${env.INPUT_PASSWORDS}`);
        logFn(`  urls: ${env.INPUT_URLS}`);
        logFn('🔧 Entries to configure:');
        entries.forEach((entry, index) => {
            logFn(`    ${index + 1}. name='${entry.name}', username='${entry.username}', url='${entry.url}'`);
        });
    }
    if (entries.length === 0) {
        logFn('No NuGet sources to configure; skipping.');
        return entries;
    }

    logFn(`Configuring ${entries.length} NuGet source(s)...`);
    for (const entry of entries) {
        logFn(`Processing NuGet source '${entry.name}' (${entry.url})`);
        const listOutput = runDotnet(exec, ['nuget', 'list', 'source'], logFn, debugMode);
        if (debugMode) {
            logFn('dotnet nuget list source output:');
            logFn(listOutput);
        }
        const registered = parseRegisteredSources(listOutput);
        const existingByName = registered.find(x => x.name.toLowerCase() === entry.name.toLowerCase());
        const existingByUrl = registered.find(x => x.url && x.url.toLowerCase() === entry.url.toLowerCase());
        if (existingByName) {
            logFn(`NuGet source '${entry.name}' already exists. Updating...`);
            runDotnet(exec, [
                'nuget',
                'update',
                'source',
                entry.name,
                '--username',
                entry.username,
                '--password',
                entry.password,
                '--store-password-in-clear-text',
                '--source',
                entry.url,
            ], logFn, debugMode);
        } else if (existingByUrl) {
            logFn(`NuGet source with URL '${entry.url}' already exists as '${existingByUrl.name}'. Removing old entry before adding '${entry.name}'.`);
            runDotnet(exec, [
                'nuget',
                'remove',
                'source',
                existingByUrl.name,
            ], logFn, debugMode);
            logFn(`Adding NuGet source '${entry.name}'...`);
            runDotnet(exec, [
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
            ], logFn, debugMode);
        } else {
            logFn(`Adding NuGet source '${entry.name}'...`);
            runDotnet(exec, [
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
            ], logFn, debugMode);
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
    parseRegisteredSources,
};