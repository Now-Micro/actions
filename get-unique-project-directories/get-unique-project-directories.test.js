const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { run, findNearestCsproj, normalizePath, parseBool, toDirectoryOnly } = require('./get-unique-project-directories');

function withEnv(env, fn) {
    const prev = { ...process.env };
    Object.assign(process.env, env);
    const showLogs = true;
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    let out = '', err = '';
    const so = process.stdout.write, se = process.stderr.write;
    if (showLogs) {
        process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
        process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
    } else {
        process.stdout.write = (c, e, cb) => { out += c; return true; };
        process.stderr.write = (c, e, cb) => { err += c; return true; };
    }
    try {
        try { fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
        process.stdout.write = so;
        process.stderr.write = se;
    }
    return { exitCode, out, err };
}

function runWith(env) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpp-'));
    const tmpOut = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(tmpOut, '');
    const result = withEnv({ ...env, GITHUB_OUTPUT: tmpOut }, () => run());
    result.outputFile = tmpOut;
    result.outputContent = fs.readFileSync(tmpOut, 'utf8');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return result;
}

function withTmpTree(setup, fn) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpp-tree-'));
    const prevCwd = process.cwd();
    process.chdir(tmpDir);
    try {
        setup(tmpDir);
        fn(tmpDir);
    } finally {
        process.chdir(prevCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function touch(relPath) {
    const full = path.resolve(relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
}

test('finds csproj in same directory (returns directory)', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Abstractions/src/Trafera.Messaging.Abstractions.csproj');
        touch('Messaging/Trafera.Messaging.Abstractions/src/SomeFile.cs');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Abstractions/src/SomeFile.cs';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths, INPUT_DEBUG_MODE: 'false' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["Messaging\/Trafera\.Messaging\.Abstractions\/src"\]/);
    });
});

test('finds csproj in parent directory when nested', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj');
        touch('Messaging/Trafera.Messaging.Project2/tests/sub/another/SomeTestFile.cs');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Project2/tests/sub/another/SomeTestFile.cs';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["Messaging\/Trafera\.Messaging\.Project2\/tests"\]/);
    });
});

test('returns no entry when no csproj exists anywhere', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Project3/README.md');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Project3/README.md';
        const r = runWith({ INPUT_PATTERN: '.*', INPUT_PATHS: paths });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\[\]/);
    });
});

test('root-level README produces no entry', () => {
    withTmpTree(() => {
        touch('README.md');
    }, () => {
        const paths = 'README.md';
        const r = runWith({ INPUT_PATTERN: '.*', INPUT_PATHS: paths });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\[\]/);
    });
});

test('root-level csproj resolves to empty directory', () => {
    withTmpTree(() => {
        touch('App.csproj');
        touch('Program.cs');
    }, () => {
        const paths = 'Program.cs';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["\."\]/);
    });
});

test('fallback regex extracts root when no csproj exists', () => {
    withTmpTree(() => {
        touch('RootA/Sub/README.md');
    }, () => {
        const paths = 'RootA/Sub/README.md';
        const r = runWith({ INPUT_PATTERN: '.*', INPUT_PATHS: paths, INPUT_FALLBACK_REGEX: '^([^/]+)' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["RootA"\]/);
    });
});

test('fallback regex non-match keeps directory', () => {
    withTmpTree(() => {
        touch('RootB/Sub/README.md');
    }, () => {
        const paths = 'RootB/Sub/README.md';
        const r = runWith({ INPUT_PATTERN: '.*', INPUT_PATHS: paths, INPUT_FALLBACK_REGEX: '^ZZZ' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\[\]/);
    });
});

test('fallback regex preserves dotted root directory name', () => {
    withTmpTree(() => {
        touch('My.Project/Sub/README.md');
    }, () => {
        const paths = 'My.Project/Sub/README.md';
        const r = runWith({ INPUT_PATTERN: '.*\\.md$', INPUT_PATHS: paths, INPUT_FALLBACK_REGEX: '^([^/]+)' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["My\.Project"\]/);
    });
});

test('debug mode prints detailed logs', () => {
    withTmpTree(() => {
        touch('Proj/src/Proj.csproj');
        touch('Proj/src/File.cs');
    }, () => {
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: 'Proj/src/File.cs', INPUT_DEBUG_MODE: 'true' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.out, /Debug mode is ON/);
        assert.match(r.out, /INPUT_PATTERN/);
        assert.match(r.out, /INPUT_PATHS/);
        assert.match(r.out, /resolved to 'Proj\/src'/);
    });
});

test('non-matching pattern returns no entry', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj');
        touch('Messaging/Trafera.Messaging.Project2/tests/SomeTestFile.md');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Project2/tests/SomeTestFile.md';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\[\]/);
    });
});

test('invalid regex exits 1', () => {
    const r = runWith({ INPUT_PATTERN: '([bad', INPUT_PATHS: 'file.cs' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid regex/);
});

test('invalid fallback regex exits 1', () => {
    const r = runWith({ INPUT_PATTERN: '.*', INPUT_PATHS: 'file.cs', INPUT_FALLBACK_REGEX: '([bad' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /Invalid fallback regex/);
});

test('missing pattern exits 1', () => {
    const r = runWith({ INPUT_PATHS: 'file.cs' });
    assert.strictEqual(r.exitCode, 1);
    assert.match(r.err + r.out, /INPUT_PATTERN is required/);
});

test('missing GITHUB_OUTPUT exits 1', () => {
    const prev = { ...process.env };
    Object.assign(process.env, { INPUT_PATTERN: '.*', INPUT_PATHS: 'file.cs', GITHUB_OUTPUT: '' });
    let exitCode = 0;
    const origExit = process.exit;
    process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
    try {
        try { run(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; }
    } finally {
        process.env = prev;
        process.exit = origExit;
    }
    assert.strictEqual(exitCode, 1);
});

test('output-is-json false emits comma-separated list', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj');
        touch('Messaging/Trafera.Messaging.Project2/tests/One.cs');
        touch('Messaging/Trafera.Messaging.Project2/tests/Two.cs');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Project2/tests/One.cs,Messaging/Trafera.Messaging.Project2/tests/Two.cs';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: 'false' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=Messaging\/Trafera\.Messaging\.Project2\/tests/);
        assert.doesNotMatch(r.outputContent, /unique_project_directories=Messaging\/Trafera\.Messaging\.Project2\/tests,Messaging\/Trafera\.Messaging\.Project2\/tests/);
    });
});

test('json output is de-duplicated', () => {
    withTmpTree(() => {
        touch('Messaging/Trafera.Messaging.Project2/tests/Trafera.Messaging.Project2.Tests.csproj');
        touch('Messaging/Trafera.Messaging.Project2/tests/One.cs');
        touch('Messaging/Trafera.Messaging.Project2/tests/Two.cs');
    }, () => {
        const paths = 'Messaging/Trafera.Messaging.Project2/tests/One.cs,Messaging/Trafera.Messaging.Project2/tests/Two.cs';
        const r = runWith({ INPUT_PATTERN: '.*\\.cs$', INPUT_PATHS: paths, INPUT_OUTPUT_IS_JSON: 'true' });
        assert.strictEqual(r.exitCode, 0);
        assert.match(r.outputContent, /unique_project_directories=\["Messaging\/Trafera\.Messaging\.Project2\/tests"\]/);
    });
});

test('helpers cover parseBool and normalizePath edge cases', () => {
    assert.strictEqual(parseBool(true, false), true);
    assert.strictEqual(parseBool(false, true), false);
    assert.strictEqual(parseBool(null, true), true);
    assert.strictEqual(parseBool('maybe', true), true);
    assert.strictEqual(normalizePath('  "C\\\\Temp\\Proj\\File.cs"  '), 'C/Temp/Proj/File.cs');
    assert.strictEqual(toDirectoryOnly(''), '');
    assert.strictEqual(toDirectoryOnly('App.csproj'), '.');
    assert.strictEqual(toDirectoryOnly('README.md'), '.');
    assert.strictEqual(toDirectoryOnly('src'), 'src');
});

test('findNearestCsproj tolerates missing directories', () => {
    const result = findNearestCsproj('no/such/dir/file.cs');
    assert.strictEqual(result, '');
});
