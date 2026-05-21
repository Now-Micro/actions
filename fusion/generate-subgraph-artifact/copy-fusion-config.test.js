const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = path.join(__dirname, 'copy-fusion-config.js');

function makeTempDir(prefix = 'fusion-config-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withCwd(cwd, fn) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return fn();
  } finally {
    process.chdir(previous);
  }
}

function runWithEnv(env, fsHook) {
  const previous = {};
  for (const key of ['INPUT_WORKING_DIRECTORY']) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);

  const fsModule = require('fs');
  const originalExistsSync = fsModule.existsSync;
  const originalReadFileSync = fsModule.readFileSync;
  if (typeof fsHook === 'function') {
    fsHook(fsModule);
  }

  delete require.cache[require.resolve(MODULE_PATH)];
  const mod = require(MODULE_PATH);

  let exitCode;
  const originalExit = process.exit;
  process.exit = code => {
    exitCode = code;
    throw new Error(`EXIT:${code}`);
  };

  let stdout = '';
  let stderr = '';
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = chunk => {
    stdout += chunk;
    return true;
  };
  process.stderr.write = chunk => {
    stderr += chunk;
    return true;
  };

  let thrownError;
  try {
    mod.run();
    exitCode = exitCode ?? 0;
  } catch (error) {
    if (!/^EXIT:/.test(error.message)) {
      thrownError = error;
    }
    exitCode = exitCode ?? 1;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
    fsModule.existsSync = originalExistsSync;
    fsModule.readFileSync = originalReadFileSync;
    delete require.cache[require.resolve(MODULE_PATH)];
    for (const key of ['INPUT_WORKING_DIRECTORY']) {
      delete process.env[key];
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value !== undefined) {
        process.env[key] = value;
      }
    }
  }

  return { exitCode, stdout, stderr, thrownError };
}

function writeTemplate(root) {
  const templatePath = path.join(root, 'dotnet-tools.json');
  fs.writeFileSync(templatePath, JSON.stringify({
    version: 1,
    isRoot: true,
    tools: {
      'hotchocolate.fusion.commandline': {
        version: '15.1.16',
        commands: ['fusion']
      }
    }
  }, null, 2) + '\n');
  return templatePath;
}

test('creates .config/dotnet-tools.json when missing', () => {
  const root = makeTempDir();
  const targetPath = path.join(root, '.config', 'dotnet-tools.json');

  const { exitCode, stdout } = withCwd(root, () => runWithEnv({}));

  assert.strictEqual(exitCode, 0);
  assert.ok(fs.existsSync(targetPath));
  const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  assert.strictEqual(parsed.tools['hotchocolate.fusion.commandline'].version, '15.1.16');
  assert.match(stdout, /Created .*\.config.*dotnet-tools\.json with Fusion tool support\./);
});

test('overrides Fusion version when .config/dotnet-tools.json already contains the tool', () => {
  const root = makeTempDir();
  const targetPath = path.join(root, '.config', 'dotnet-tools.json');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify({
    version: 1,
    isRoot: true,
    tools: {
      'hotchocolate.fusion.commandline': {
        version: '14.0.0',
        commands: ['fusion']
      },
      other: {
        version: '1.0.0',
        commands: ['other']
      }
    }
  }, null, 2) + '\n');
  const before = fs.readFileSync(targetPath, 'utf8');

  const { exitCode, stdout } = withCwd(root, () => runWithEnv({}));
  const after = fs.readFileSync(targetPath, 'utf8');

  assert.strictEqual(exitCode, 0);
  assert.notStrictEqual(after, before);
  assert.match(stdout, /Fusion tool already present/);
  const parsed = JSON.parse(after);
  assert.strictEqual(parsed.tools['hotchocolate.fusion.commandline'].version, '15.1.16');
  assert.strictEqual(parsed.tools.other.version, '1.0.0');
});

test('adds Fusion tool to existing .config/dotnet-tools.json when missing', () => {
  const root = makeTempDir();
  const targetPath = path.join(root, '.config', 'dotnet-tools.json');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify({
    version: 1,
    isRoot: true,
    tools: {
      other: {
        version: '1.0.0',
        commands: ['other']
      }
    }
  }, null, 2) + '\n');

  const { exitCode, stdout } = withCwd(root, () => runWithEnv({}));

  assert.strictEqual(exitCode, 0);
  const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  assert.ok(parsed.tools.other);
  assert.ok(parsed.tools['hotchocolate.fusion.commandline']);
  assert.strictEqual(parsed.tools['hotchocolate.fusion.commandline'].version, '15.1.16');
  assert.match(stdout, /Added Fusion tool definition/);
});

test('adds Fusion tool when target manifest has no tools object', () => {
  const root = makeTempDir();
  const targetPath = path.join(root, '.config', 'dotnet-tools.json');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify({
    version: 1,
    isRoot: true
  }, null, 2) + '\n');

  const { exitCode, stdout } = withCwd(root, () => runWithEnv({}));

  assert.strictEqual(exitCode, 0);
  const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  assert.ok(parsed.tools);
  assert.ok(parsed.tools['hotchocolate.fusion.commandline']);
  assert.match(stdout, /Added Fusion tool definition/);
});

test('exits 1 when the bundled template dotnet-tools.json is malformed', () => {
  const root = makeTempDir();
  const { exitCode, stderr } = withCwd(root, () => runWithEnv({}, fsModule => {
    const originalRead = fsModule.readFileSync;
    fsModule.readFileSync = (filePath, encoding) => {
      if (String(filePath).endsWith(path.join('fusion', 'generate-subgraph-artifact', 'dotnet-tools.json'))) {
        return '{ malformed json';
      }
      return originalRead.call(fsModule, filePath, encoding);
    };
  }));

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /Failed to read or parse .*dotnet-tools\.json/i);
});

test('exits 1 when the target .config/dotnet-tools.json is malformed', () => {
  const root = makeTempDir();
  const targetPath = path.join(root, '.config', 'dotnet-tools.json');
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, '{ malformed json');

  const { exitCode, stderr } = withCwd(root, () => runWithEnv({}));

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /Failed to read or parse .*\.config.*dotnet-tools\.json/i);
});

test('exits 1 when the bundled template manifest is missing', () => {
  const root = makeTempDir();
  const templateSuffix = path.join('fusion', 'generate-subgraph-artifact', 'dotnet-tools.json');

  const { exitCode, stderr } = withCwd(root, () => runWithEnv({}, fsModule => {
    const originalExists = fsModule.existsSync;
    fsModule.existsSync = filePath => {
      if (String(filePath).endsWith(templateSuffix)) {
        return false;
      }
      return originalExists.call(fsModule, filePath);
    };
  }));

  assert.strictEqual(exitCode, 1);
  assert.match(stderr, /Missing Fusion tool template/i);
});
