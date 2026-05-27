
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD_PATH = path.join(__dirname, 'generate-fusion-subgraph-artifact.js');

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(prefix = 'fsg-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Run generate-fusion-subgraph.run() with the given env vars and an optional
 * spawnSync stub.  Automatically tears down all mocks and restores the
 * require cache afterwards.
 *
 * @param {Record<string,string>} env
 * @param {(cmd:string,args:string[],opts:object)=>object} [spawnStub]  stub for child_process.spawnSync
 * @returns {{ exitCode, stdout, stderr, spawnCalls, outputContent, tmpDir }}
 */
function runWithEnv(env, spawnStub = () => ({ status: 0 })) {
  const tmpDir = makeTempDir();
  const outputFile = path.join(tmpDir, 'github-output.txt');
  fs.writeFileSync(outputFile, '');

  // Save and clear INPUT_* / GITHUB_OUTPUT
  const prev = {};
  [...Object.keys(process.env).filter(k => k.startsWith('INPUT_')), 'GITHUB_OUTPUT', 'GITHUB_SHA', 'RUNNER_TEMP', 'GITHUB_RUN_ID'].forEach(k => {
    prev[k] = process.env[k];
    delete process.env[k];
  });
  process.env.GITHUB_OUTPUT = outputFile;
  Object.assign(process.env, env);

  // Stub spawnSync
  const cp = require('child_process');
  const origSpawn = cp.spawnSync;
  const spawnCalls = [];
  cp.spawnSync = (cmd, args, opts) => {
    spawnCalls.push({ cmd: String(cmd), args: Array.isArray(args) ? [...args] : [], opts: { ...opts } });
    if (cmd === 'dotnet' && Array.isArray(args) && args[0] === 'run' && args.includes('--output')) {
      const outputPath = args[args.indexOf('--output') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'type Query { hello: String }\n');
    }
    return spawnStub(cmd, args, opts);
  };

  // Fresh module load with the stub in place
  delete require.cache[require.resolve(MOD_PATH)];
  const mod = require(MOD_PATH);

  // Capture process.exit
  let exitCode;
  const origExit = process.exit;
  process.exit = (code) => { exitCode = code; throw new Error(`EXIT:${code}`); };

  // Capture stdout / stderr
  let stdout = '', stderr = '';
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (c) => { stdout += c; return true; };
  process.stderr.write = (c) => { stderr += c; return true; };

  let thrownError;
  try {
    mod.run();
    exitCode = exitCode ?? 0;
  } catch (e) {
    if (!/^EXIT:/.test(e.message)) thrownError = e;
    exitCode = exitCode ?? 1;
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exit = origExit;
    cp.spawnSync = origSpawn;
    delete require.cache[require.resolve(MOD_PATH)];
    [...Object.keys(process.env).filter(k => k.startsWith('INPUT_')), 'GITHUB_OUTPUT', 'GITHUB_SHA', 'RUNNER_TEMP', 'GITHUB_RUN_ID'].forEach(k => {
      delete process.env[k];
    });
    Object.entries(prev).forEach(([k, v]) => { if (v !== undefined) process.env[k] = v; });
  }

  const outputContent = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
  return { exitCode, stdout, stderr, spawnCalls, outputContent, tmpDir, thrownError };
}

function expectedPublishDir(env = {}) {
  const rawRunId = (env.GITHUB_RUN_ID || '').trim();
  const runId = /^[A-Za-z0-9._-]+$/.test(rawRunId) ? rawRunId : 'local';
  const publishRoot = (env.RUNNER_TEMP || '').trim() || os.tmpdir();
  return path.resolve(publishRoot, 'now-micro-fusion-subgraph-artifacts', runId);
}

/**
 * Build a minimal valid env for the action.
 */
function baseEnv(base, overrides = {}) {
  const defaultRunnerTemp = path.join(base, 'runner-temp');
  const defaultRunId = path.basename(base);

  return {
    INPUT_PROJECT_PATH: path.join(base, 'src', 'App.csproj'),
    INPUT_SCHEMA_DIR: path.join(base, 'schema'),
    INPUT_SUBGRAPH_NAME: 'my-subgraph',
    INPUT_ARTIFACT_VERSION: '1.0.0',
    INPUT_COMMIT_SHA: 'abc1234',
    INPUT_SOURCE_REPO_URL: 'https://github.com/org/repo',
    INPUT_SUBGRAPH_HTTP_URL: 'http://localhost:4000',
    INPUT_DEBUG_MODE: 'false',
    INPUT_WORKING_DIRECTORY: '',
    RUNNER_TEMP: defaultRunnerTemp,
    GITHUB_RUN_ID: defaultRunId,
    ...overrides,
  };
}

// ─── success path ─────────────────────────────────────────────────────────────

test('success: runs expected dotnet commands in order', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);

  // Exact sequence of four dotnet calls
  assert.strictEqual(spawnCalls.length, 4);
  assert.deepStrictEqual(spawnCalls[0].args, ['tool', 'restore']);
  assert.deepStrictEqual(spawnCalls[1].args.slice(0, 4), ['run', '--project', path.join(tmp, 'src', 'App.csproj'), '--']);
  assert.deepStrictEqual(spawnCalls[1].args.slice(4), ['schema', 'export', '--output', path.join(tmp, 'schema', 'schema.graphql')]);
  assert.deepStrictEqual(spawnCalls[2].args, ['fusion', 'subgraph', 'config', 'set', 'http', '--url', 'http://localhost:4000', '-w', path.join(tmp, 'schema')]);
  assert.deepStrictEqual(spawnCalls[3].args, ['fusion', 'subgraph', 'pack', '-s', path.join(tmp, 'schema', 'schema.graphql'), '-c', path.join(tmp, 'schema', 'subgraph-config.json'), '-p', path.join(expectedPublishDir(env), 'my-subgraph.fsp')]);
  // No -e flag when no extensions file
  assert.ok(!spawnCalls[3].args.includes('-e'));
});

test('success: creates schema-dir and runner-safe publish-dir', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  const { exitCode, outputContent } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.ok(fs.existsSync(env.INPUT_SCHEMA_DIR), 'schema-dir should be created');
  const artifactPathMatch = outputContent.match(/artifact-path=(.*)/);
  assert.ok(artifactPathMatch, 'artifact-path output should be present');
  const actualPublishDir = path.dirname(artifactPathMatch[1].trim());
  assert.ok(fs.existsSync(actualPublishDir), 'runner-safe publish-dir should be created');
});

test('success: writes subgraph-config.json with correct content', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  const { exitCode } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const configPath = path.join(env.INPUT_SCHEMA_DIR, 'subgraph-config.json');
  assert.ok(fs.existsSync(configPath), 'subgraph-config.json should be written');
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.strictEqual(parsed.subgraph, 'my-subgraph');
  assert.deepStrictEqual(parsed.http, { baseAddress: 'http://localhost:4000' });
});

test('success: no project-path works when schema.graphql is already present', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_PROJECT_PATH: '' });
  fs.mkdirSync(env.INPUT_SCHEMA_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.INPUT_SCHEMA_DIR, 'schema.graphql'), 'type Query { hello: String }\n');

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(spawnCalls.length, 3);
  assert.deepStrictEqual(spawnCalls[0].args, ['tool', 'restore']);
  assert.deepStrictEqual(spawnCalls[1].args, ['fusion', 'subgraph', 'config', 'set', 'http', '--url', 'http://localhost:4000', '-w', path.join(tmp, 'schema')]);
  assert.deepStrictEqual(spawnCalls[2].args, ['fusion', 'subgraph', 'pack', '-s', path.join(tmp, 'schema', 'schema.graphql'), '-c', path.join(tmp, 'schema', 'subgraph-config.json'), '-p', path.join(expectedPublishDir(env), 'my-subgraph.fsp')]);
});

test('success: trims whitespace around project-path and directory inputs', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, {
    INPUT_PROJECT_PATH: '   ',
    INPUT_SCHEMA_DIR: '  schema  ',
    INPUT_WORKING_DIRECTORY: tmp,
  });

  const schemaDir = path.join(tmp, 'schema');
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, 'schema.graphql'), 'type Query { hello: String }\n');

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(spawnCalls.length, 3);
  const publishDir = expectedPublishDir(env);
  assert.strictEqual(fs.existsSync(publishDir), true);
  assert.strictEqual(fs.existsSync(path.join(publishDir, 'my-subgraph.metadata.json')), true);
  assert.ok(spawnCalls.every(call => call.opts.cwd === tmp), 'working-directory should still be respected');
});

test('exits 1 when project-path is empty and schema.graphql is missing', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_PROJECT_PATH: '' });

  const { exitCode, stderr } = runWithEnv(env);

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /schema file not found/i);
  assert.match(stderr, /provide project-path/i);
});

test('debug mode logs generated schema and config contents', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });

  const spawnStub = (cmd, args) => {
    if (cmd === 'dotnet' && Array.isArray(args) && args[0] === 'run' && args.includes('--output')) {
      const outputPath = args[args.indexOf('--output') + 1];
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'type Query { hello: String }\n');
    }
    return { status: 0 };
  };

  const { exitCode, stdout } = runWithEnv(env, spawnStub);

  assert.strictEqual(exitCode, 0);
  assert.match(stdout, /Contents of .*schema\.graphql:/);
  assert.match(stdout, /Contents of .*subgraph-config\.json:/);
  assert.match(stdout, /"subgraph":"my-subgraph"/);
  assert.match(stdout, /"http":\{"baseAddress":"http:\/\/localhost:4000"\}/);
  assert.match(stdout, /type Query/i);
});

test('debug mode logs fusion pack arguments', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });

  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.match(stdout, /Running Fusion pack with args:/);
  assert.match(stdout, /"fusion"/);
  assert.match(stdout, /"subgraph"/);
  assert.match(stdout, /"pack"/);
});

test('success: writes metadata JSON with correct fields', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_COMMIT_SHA: 'deadbeef', INPUT_SOURCE_REPO_URL: 'https://example.com/repo' });
  const { exitCode } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const metadataPath = path.join(expectedPublishDir(env), 'my-subgraph.metadata.json');
  assert.ok(fs.existsSync(metadataPath), 'metadata JSON should be written');
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.strictEqual(meta.subgraphName, 'my-subgraph');
  assert.strictEqual(meta.artifactVersion, '1.0.0');
  assert.strictEqual(meta.commitSha, 'deadbeef');
  assert.strictEqual(meta.sourceRepoUrl, 'https://example.com/repo');
  assert.ok(meta.generationDateUtc, 'generationDateUtc should be present');
  // ISO 8601 format
  assert.match(meta.generationDateUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('debug mode logs generated metadata contents', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });

  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.match(stdout, /Contents of .*metadata\.json:/);
  assert.match(stdout, /"subgraphName": "my-subgraph"/);
  assert.match(stdout, /"artifactVersion": "1\.0\.0"/);
});

test('success: writes artifact-path and metadata-path to GITHUB_OUTPUT', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  const { exitCode, outputContent } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.match(outputContent, /artifact-path=.*my-subgraph\.fsp/);
  assert.match(outputContent, /metadata-path=.*my-subgraph\.metadata\.json/);
});

test('success: metadata commit-sha falls back to GITHUB_SHA when INPUT_COMMIT_SHA is empty', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_COMMIT_SHA: '' });
  env.GITHUB_SHA = 'sha-from-env';
  const { exitCode } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const metadataPath = path.join(expectedPublishDir(env), 'my-subgraph.metadata.json');
  const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.strictEqual(meta.commitSha, 'sha-from-env');
});

// ─── extensions file ──────────────────────────────────────────────────────────

test('with extensions: pack command includes -e flag when schema.extensions.graphql exists', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  const schemaDir = env.INPUT_SCHEMA_DIR;

  // Pre-create schema-dir and extensions file to simulate it existing
  fs.mkdirSync(schemaDir, { recursive: true });
  const extensionsPath = path.join(schemaDir, 'schema.extensions.graphql');
  fs.writeFileSync(extensionsPath, 'extend type Query { hello: String }');

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const packCall = spawnCalls.find(call => call.args.includes('pack'));
  assert.ok(packCall, 'pack command should be present');
  assert.deepStrictEqual(packCall.args.slice(-2), ['-e', path.join(tmp, 'schema', 'schema.extensions.graphql')]);
});

test('with extensions: debug log says schema.extensions.graphql was found', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });
  const schemaDir = env.INPUT_SCHEMA_DIR;

  fs.mkdirSync(schemaDir, { recursive: true });
  const extensionsPath = path.join(schemaDir, 'schema.extensions.graphql');
  fs.writeFileSync(extensionsPath, 'extend type Query { hello: String }');

  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.match(stdout, new RegExp(`Checking for schema extensions file at ${escapeRegExp(extensionsPath)}`));
  assert.match(stdout, new RegExp(`Found schema extensions file: ${escapeRegExp(extensionsPath)}`));
});

test('without extensions: pack command omits -e flag when no extensions file', () => {
  const tmp = makeTempDir();
  const { exitCode, spawnCalls } = runWithEnv(baseEnv(tmp));

  assert.strictEqual(exitCode, 0);
  const packCall = spawnCalls.find(call => call.args.includes('pack'));
  assert.ok(packCall, 'pack command should be present');
  assert.ok(!packCall.args.includes('-e'));
});

test('without extensions: debug log says schema.extensions.graphql was not found', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });

  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const extensionsPath = path.join(env.INPUT_SCHEMA_DIR, 'schema.extensions.graphql');
  assert.match(stdout, new RegExp(`Checking for schema extensions file at ${escapeRegExp(extensionsPath)}`));
  assert.match(stdout, new RegExp(`No schema extensions file found at ${escapeRegExp(extensionsPath)}`));
});

test('custom schema-file-name is used for export and pack arguments', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_SCHEMA_FILE_NAME: 'custom-schema.graphql' });

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.deepStrictEqual(spawnCalls[1].args.slice(4), ['schema', 'export', '--output', path.join(tmp, 'schema', 'custom-schema.graphql')]);
  assert.deepStrictEqual(spawnCalls[3].args, ['fusion', 'subgraph', 'pack', '-s', path.join(tmp, 'schema', 'custom-schema.graphql'), '-c', path.join(tmp, 'schema', 'subgraph-config.json'), '-p', path.join(expectedPublishDir(env), 'my-subgraph.fsp')]);
});

test('custom schema-extensions-file-name is used for pack -e when file exists', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_SCHEMA_EXTENSIONS_FILE_NAME: 'custom.extensions.graphql' });
  const schemaDir = env.INPUT_SCHEMA_DIR;

  fs.mkdirSync(schemaDir, { recursive: true });
  const extensionsPath = path.join(schemaDir, 'custom.extensions.graphql');
  fs.writeFileSync(extensionsPath, 'extend type Query { hello: String }');

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const packCall = spawnCalls.find(call => call.args.includes('pack'));
  assert.ok(packCall, 'pack command should be present');
  assert.deepStrictEqual(packCall.args.slice(-2), ['-e', extensionsPath]);
});

// ─── custom inputs ────────────────────────────────────────────────────────────

test('custom subgraph-http-url is used in config set command', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_SUBGRAPH_HTTP_URL: 'https://myapi.example.com/graphql' });
  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const configCall = spawnCalls.find(call => call.args.includes('config'));
  assert.ok(configCall, 'config set http command should be present');
  assert.ok(configCall.args.includes('https://myapi.example.com/graphql'));
});

test('working-directory is passed as cwd to spawnSync', () => {
  const tmp = makeTempDir();
  const workDir = path.join(tmp, 'workspace');
  fs.mkdirSync(workDir, { recursive: true });
  const env = baseEnv(tmp, { INPUT_WORKING_DIRECTORY: workDir });

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.ok(spawnCalls.length > 0, 'spawn calls should be recorded');
  assert.ok(spawnCalls.every(call => call.opts.cwd === workDir), 'all spawn calls should use the working-directory');
});

test('empty working-directory omits cwd from spawnSync options', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_WORKING_DIRECTORY: '' });

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.ok(spawnCalls.every(call => !call.opts.cwd), 'no cwd should be set when working-directory is empty');
});

test('relative schema-dir resolves and outputs use runner-safe absolute paths', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, {
    INPUT_SCHEMA_DIR: 'schema',
    INPUT_WORKING_DIRECTORY: tmp,
  });

  const { exitCode, outputContent } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const publishDir = expectedPublishDir(env);
  const expectedArtifactPath = path.join(publishDir, 'my-subgraph.fsp');
  const expectedMetadataPath = path.join(publishDir, 'my-subgraph.metadata.json');
  assert.match(outputContent, new RegExp(`artifact-path=${escapeRegExp(expectedArtifactPath)}`));
  assert.match(outputContent, new RegExp(`metadata-path=${escapeRegExp(expectedMetadataPath)}`));
  assert.match(outputContent, new RegExp(`publish-dir=${escapeRegExp(publishDir)}`));
  assert.ok(path.isAbsolute(expectedArtifactPath));
  assert.ok(path.isAbsolute(expectedMetadataPath));
});

test('quote-bearing URL input is preserved as a single spawn argument', () => {
  const tmp = makeTempDir();
  const maliciousUrl = 'http://localhost:4000/" --fake-flag';
  const env = baseEnv(tmp, { INPUT_SUBGRAPH_HTTP_URL: maliciousUrl });

  const { exitCode, spawnCalls } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const configCall = spawnCalls.find(call => call.args.includes('config'));
  assert.ok(configCall, 'config call should be present');
  assert.ok(configCall.args.includes(maliciousUrl));
  assert.strictEqual(configCall.args.filter(arg => arg === '--fake-flag').length, 0);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── missing required inputs ──────────────────────────────────────────────────

test('exits 1 when schema-dir is missing', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  delete env.INPUT_SCHEMA_DIR;
  const { exitCode, stderr } = runWithEnv(env);
  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /schema-dir/i);
});

test('uses RUNNER_TEMP when provided for output location', () => {
  const tmp = makeTempDir();
  const runnerTemp = path.join(tmp, 'runner-temp');
  const env = baseEnv(tmp, { RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: '12345' });

  const { exitCode, outputContent } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const publishDir = expectedPublishDir(env);
  const expectedArtifactPath = path.join(publishDir, 'my-subgraph.fsp');
  assert.match(outputContent, new RegExp(`artifact-path=${escapeRegExp(expectedArtifactPath)}`));
  assert.ok(fs.existsSync(publishDir), 'publish-dir under RUNNER_TEMP should be created');
});

test('invalid GITHUB_RUN_ID falls back to local publish segment', () => {
  const tmp = makeTempDir();
  const runnerTemp = path.join(tmp, 'runner-temp');
  const env = baseEnv(tmp, { RUNNER_TEMP: runnerTemp, GITHUB_RUN_ID: '../escape/attempt' });

  const { exitCode, outputContent } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  const publishDir = expectedPublishDir(env);
  assert.strictEqual(path.basename(publishDir), 'local');
  assert.match(outputContent, new RegExp(`publish-dir=${escapeRegExp(publishDir)}`));
  assert.ok(fs.existsSync(publishDir), 'fallback local publish-dir should be created for invalid run id');
});

test('exits 1 when schema-file-name includes path traversal', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_SCHEMA_FILE_NAME: '../schema.graphql' });

  const { exitCode, stderr } = runWithEnv(env);

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /schema-file-name/i);
  assert.match(stderr, /basename/i);
});

test('exits 1 when schema-extensions-file-name is absolute path', () => {
  const tmp = makeTempDir();
  const absoluteName = path.resolve(tmp, 'schema.extensions.graphql');
  const env = baseEnv(tmp, { INPUT_SCHEMA_EXTENSIONS_FILE_NAME: absoluteName });

  const { exitCode, stderr } = runWithEnv(env);

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /schema-extensions-file-name/i);
  assert.match(stderr, /basename/i);
});

test('exits 1 when subgraph-name is missing', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  delete env.INPUT_SUBGRAPH_NAME;
  const { exitCode, stderr } = runWithEnv(env);
  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /subgraph-name/i);
});

test('exits 1 when artifact-version is missing', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  delete env.INPUT_ARTIFACT_VERSION;
  const { exitCode, stderr } = runWithEnv(env);
  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /artifact-version/i);
});

// ─── error propagation ────────────────────────────────────────────────────────

test('propagates error when dotnet tool restore fails', () => {
  const tmp = makeTempDir();
  const { exitCode, thrownError } = runWithEnv(baseEnv(tmp), (cmd, args) => {
    if (cmd === 'dotnet' && Array.isArray(args) && args[0] === 'tool' && args[1] === 'restore') {
      const e = new Error('dotnet not found'); e.status = 1; throw e;
    }
    return '';
  });
  // Should throw or exit non-zero — the error propagates out of run()
  assert.ok(exitCode !== 0 || thrownError, 'should fail when dotnet tool restore throws');
});

test('propagates error when dotnet fusion pack fails', () => {
  const tmp = makeTempDir();
  const { exitCode, thrownError } = runWithEnv(baseEnv(tmp), (cmd, args) => {
    if (cmd === 'dotnet' && Array.isArray(args) && args[0] === 'fusion' && args[1] === 'subgraph' && args[2] === 'pack') {
      const e = new Error('pack failed'); e.status = 1; throw e;
    }
    return '';
  });
  assert.ok(exitCode !== 0 || thrownError, 'should fail when subgraph pack throws');
});

// ─── GITHUB_OUTPUT handling ───────────────────────────────────────────────────

test('does not crash when GITHUB_OUTPUT is not set', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp);
  delete env.GITHUB_OUTPUT;

  // Temporarily clear GITHUB_OUTPUT before runWithEnv sets it
  const savedOutput = process.env.GITHUB_OUTPUT;
  delete process.env.GITHUB_OUTPUT;

  const { exitCode } = runWithEnv({ ...env, GITHUB_OUTPUT: '' });
  if (savedOutput !== undefined) process.env.GITHUB_OUTPUT = savedOutput;

  assert.strictEqual(exitCode, 0);
});

// ─── debug mode ───────────────────────────────────────────────────────────────

test('debug mode emits diagnostic log lines', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'true' });
  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.match(stdout, /🔍/);
  assert.match(stdout, /project-path/i);
  assert.match(stdout, /schema-dir/i);
});

test('debug mode off produces no 🔍 debug lines', () => {
  const tmp = makeTempDir();
  const env = baseEnv(tmp, { INPUT_DEBUG_MODE: 'false' });
  const { exitCode, stdout } = runWithEnv(env);

  assert.strictEqual(exitCode, 0);
  assert.doesNotMatch(stdout, /🔍/);
});
