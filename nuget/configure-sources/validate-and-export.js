#!/usr/bin/env node
const fs = require('fs');

function log(m) { process.stdout.write(String(m) + "\n"); }
function err(m) { process.stderr.write(String(m) + "\n"); }

function get(name) { return process.env[name] || ''; }

function splitCsvKeepEmpty(s) {
    return s.split(',').map(x => x.trim());
}

function setOutput(name, value) {
    const f = process.env.GITHUB_OUTPUT;
    if (!f) { err('GITHUB_OUTPUT not set'); process.exit(1); }
    fs.appendFileSync(f, `${name}=${value}\n`);
}

try {
    const namesRaw = get('INPUT_NAMES');
    const usersRaw = get('INPUT_USERNAMES');
    const pwdsRaw = get('INPUT_PASSWORDS');
    const urlsRaw = get('INPUT_URLS');
    const debugRaw = get('INPUT_DEGUG_MODE');
    const DEBUG = /^true$/i.test(String(debugRaw).trim());

    if (DEBUG) {
        log(`🔍 Raw inputs:`);
        log(`  names='${namesRaw}'`);
        log(`  usernames='${usersRaw}'`);
        log(`  passwords='${pwdsRaw}'`);
        log(`  urls='${urlsRaw}'`);
        log(`  degug-mode='${debugRaw}'`);
    }

    // If any input is missing or blank, emit empty outputs for all and succeed
    const isMissing = (s) => !s || s.trim() === '';
    if (isMissing(namesRaw) || isMissing(usersRaw) || isMissing(pwdsRaw) || isMissing(urlsRaw)) {
        if (DEBUG) log('⚠️  One or more required inputs missing; emitting empty outputs.');
        setOutput('count', '0');
        setOutput('names', '');
        setOutput('usernames', '');
        setOutput('passwords', '');
        setOutput('urls', '');
        return;
    }

    const namesAll = splitCsvKeepEmpty(namesRaw);
    const usersAll = splitCsvKeepEmpty(usersRaw);
    const pwdsAll = splitCsvKeepEmpty(pwdsRaw);
    const urlsAll = splitCsvKeepEmpty(urlsRaw);

    if (DEBUG) {
        log('🔧 Parsed arrays (including empties):');
        log(`  names=[${namesAll.map(x=>`'${x}'`).join(', ')}]`);
        log(`  usernames=[${usersAll.map(x=>`'${x}'`).join(', ')}]`);
        log(`  passwords=[${pwdsAll.map(x=>`'${x}'`).join(', ')}]`);
        log(`  urls=[${urlsAll.map(x=>`'${x}'`).join(', ')}]`);
    }

    // Remove empties independently for count baseline of non-name fields
    const usersNZ = usersAll.filter(x => x !== '');
    const pwdsNZ = pwdsAll.filter(x => x !== '');
    const urlsNZ = urlsAll.filter(x => x !== '');

    const commonNonName = Math.min(usersNZ.length, pwdsNZ.length, urlsNZ.length);
    if (commonNonName <= 0) {
        // nothing usable; emit empties
        if (DEBUG) log('⚠️  No usable non-name entries after filtering empties; emitting empty outputs.');
        setOutput('count', '0');
        setOutput('names', '');
        setOutput('usernames', '');
        setOutput('passwords', '');
        setOutput('urls', '');
        return;
    }

    // Build non-name windows from the start
    const usersWin = usersNZ.slice(0, commonNonName);
    const pwdsWin = pwdsNZ.slice(0, commonNonName);
    const urlsWin = urlsNZ.slice(0, commonNonName);

    // Names: count leading empties to influence alignment
    let leadingEmpty = 0;
    for (const n of namesAll) { if (n === '') leadingEmpty++; else break; }
    const namesNZ = namesAll.filter(x => x !== '');
    const maxNamesAllowed = Math.max(0, commonNonName - leadingEmpty);
    const nameEmitCount = Math.min(namesNZ.length, maxNamesAllowed);

    // Select names from the start
    const namesSel = namesNZ.slice(0, nameEmitCount);

    // Select non-names aligned: if fewer names than common, take from end; else from start
    const usersSel = nameEmitCount < commonNonName ? usersWin.slice(-nameEmitCount) : usersWin.slice(0, commonNonName);
    const pwdsSel = nameEmitCount < commonNonName ? pwdsWin.slice(-nameEmitCount) : pwdsWin.slice(0, commonNonName);
    const urlsSel = nameEmitCount < commonNonName ? urlsWin.slice(-nameEmitCount) : urlsWin.slice(0, commonNonName);

    setOutput('count', String(nameEmitCount));
    setOutput('names', namesSel.join(','));
    setOutput('usernames', usersSel.join(','));
    setOutput('passwords', pwdsSel.join(','));
    setOutput('urls', urlsSel.join(','));

    if (DEBUG) {
        log('✅ Normalized outputs:');
        log(`  count=${nameEmitCount}`);
        log(`  names=${namesSel.join(',')}`);
        log(`  usernames=${usersSel.join(',')}`);
        log(`  passwords=${pwdsSel.join(',')}`);
        log(`  urls=${urlsSel.join(',')}`);
    }

    log(`Validated ${nameEmitCount} source(s).`);
} catch (e) { err(e?.stack || String(e)); process.exit(1); }
