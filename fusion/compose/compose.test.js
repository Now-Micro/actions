const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE_PATH = path.join(__dirname, 'compose.js');

function makeTempDir(prefix = 'fusion-compose-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function runWithEnv(env, options = {}) {
  const tempRoot = makeTempDir();
  const githubOutput = path.join(tempRoot, 'github-output.txt');
  fs.writeFileSync(githubOutput, '');

  const previousEnv = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('INPUT_')) {
      delete process.env[key];
    }
  }

  process.env.GITHUB_OUTPUT = githubOutput;
  Object.assign(process.env, env);

  const childProcess = require('child_process');
  const originalSpawnSync = childProcess.spawnSync;
  const spawnCalls = [];

  childProcess.spawnSync = (command, args, spawnOptions) => {
    const call = {
      command,
      args: Array.isArray(args) ? [...args] : [],
      options: spawnOptions || {},
    };
    spawnCalls.push(call);

    if (typeof options.spawnHook === 'function') {
      const customResult = options.spawnHook(call);
      if (customResult) {
        return customResult;
      }
    }

    if (
      command === 'dotnet' &&
      Array.isArray(args) &&
      args.length >= 6 &&
      args[0] === 'tool' &&
      args[1] === 'run' &&
      args[2] === 'fusion' &&
      args[3] === 'compose'
    ) {
      const outputIndex = args.indexOf('-p');
      if (outputIndex >= 0 && args[outputIndex + 1]) {
        const outputPath = args[outputIndex + 1];
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, 'composed\n');
      }
    }

    if (command === 'gh' && Array.isArray(args) && args[0] === 'release' && args[1] === 'download') {
      const dirIndex = args.indexOf('--dir');
      const patternIndex = args.indexOf('--pattern');
      if (dirIndex >= 0 && patternIndex >= 0) {
        const targetDirectory = args[dirIndex + 1];
        const assetName = args[patternIndex + 1];
        fs.mkdirSync(targetDirectory, { recursive: true });
        fs.writeFileSync(path.join(targetDirectory, assetName), 'asset\n');
      }
    }

    return { status: 0 };
  };

  let exitCode;
  const originalExit = process.exit;
  process.exit = (code) => {
    exitCode = code;
    throw new Error(`__EXIT_${code}__`);
  };

  let stdout = '';
  let stderr = '';
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = (chunk) => {
    stdout += chunk;
    return true;
  };
  process.stderr.write = (chunk) => {
    stderr += chunk;
    return true;
  };

  let thrownError;
  try {
    delete require.cache[require.resolve(MODULE_PATH)];
    const mod = require(MODULE_PATH);
    mod.run();
    exitCode = exitCode ?? 0;
  } catch (error) {
    if (!/^__EXIT_/.test(error.message)) {
      thrownError = error;
    }
    exitCode = exitCode ?? 1;
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    process.exit = originalExit;
    childProcess.spawnSync = originalSpawnSync;
    process.env = previousEnv;
    delete require.cache[require.resolve(MODULE_PATH)];
  }

  const outputContent = fs.existsSync(githubOutput) ? fs.readFileSync(githubOutput, 'utf8') : '';
  return { exitCode, stdout, stderr, spawnCalls, outputContent, tempRoot, thrownError };
}

function createValidEnvironment(root, overrides = {}) {
  const dotnetToolsManifestPath = path.join(root, '.config', 'dotnet-tools.json');
  writeJson(dotnetToolsManifestPath, {
    version: 1,
    isRoot: true,
    tools: {
      'hotchocolate.fusion.commandline': {
        version: '15.1.16',
        commands: ['fusion'],
      },
    },
  });

  const inputDirectory = path.join(root, 'artifacts', 'subgraphs');
  fs.mkdirSync(inputDirectory, { recursive: true });
  fs.writeFileSync(path.join(inputDirectory, 'alpha.fsp'), 'alpha\n');
  fs.writeFileSync(path.join(inputDirectory, 'beta.fsp'), 'beta\n');

  const manifestPath = path.join(root, 'gateway-release.json');
  writeJson(manifestPath, {
    outputDirectory: 'artifacts/subgraphs',
    subgraphs: [],
  });

  return {
    INPUT_WORKING_DIRECTORY: root,
    INPUT_DOTNET_TOOLS_MANIFEST_PATH: '.config/dotnet-tools.json',
    INPUT_MANIFEST_PATH: 'gateway-release.json',
    INPUT_INPUT_DIRECTORY: 'artifacts/subgraphs',
    INPUT_OUTPUT_FILE: 'src/Trafera.GraphQL.Gateway/gateway.fgp',
    INPUT_OUTPUT_DIRECTORY: '',
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'false',
    INPUT_RUN_DOTNET_TOOL_RESTORE: 'true',
    INPUT_VERIFY_FUSION_COMMAND: 'true',
    INPUT_SUBGRAPH_FILE_EXTENSION: '.fsp',
    INPUT_DEBUG_MODE: 'false',
    ...overrides,
  };
}

test('success: compose only writes output and outputs metadata', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root);

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  assert.match(result.outputContent, /input-directory=.*artifacts[\\/]subgraphs/);
  assert.match(result.outputContent, /output-file=.*gateway\.fgp/);
  assert.match(result.outputContent, /subgraph-count=2/);

  const outputFile = path.join(root, 'src', 'Trafera.GraphQL.Gateway', 'gateway.fgp');
  assert.ok(fs.existsSync(outputFile));

  const composeCall = result.spawnCalls.find(c =>
    c.command === 'dotnet' && c.args[0] === 'tool' && c.args[1] === 'run' && c.args[3] === 'compose'
  );
  assert.ok(composeCall, 'compose command should run');
  assert.strictEqual(composeCall.args.filter(a => a === '-s').length, 2);
});

test('success: restore mode downloads assets and composes renamed .fsp files', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
    INPUT_INPUT_DIRECTORY: 'artifacts/subgraphs',
    INPUT_GH_TOKEN: 'ghp_test',
  });

  writeJson(path.join(root, 'gateway-release.json'), {
    outputDirectory: 'artifacts/subgraphs',
    subgraphs: [
      {
        name: 'accounts',
        repository: 'Now-Micro/accounts',
        releaseTag: 'v1.2.3',
        assetName: 'accounts-release.fsp',
      },
      {
        name: 'products',
        repository: 'Now-Micro/products',
        releaseTag: 'v2.0.0',
        assetName: 'products-release.fsp',
      },
    ],
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  const ghDownloadCalls = result.spawnCalls.filter(
    c => c.command === 'gh' && c.args[0] === 'release' && c.args[1] === 'download'
  );
  assert.strictEqual(ghDownloadCalls.length, 2);
  assert.ok(ghDownloadCalls.every(c => c.options && c.options.env && c.options.env.GH_TOKEN === 'ghp_test'));

  assert.ok(fs.existsSync(path.join(root, 'artifacts', 'subgraphs', 'accounts', 'accounts.fsp')));
  assert.ok(fs.existsSync(path.join(root, 'artifacts', 'subgraphs', 'products', 'products.fsp')));
});

test('success: output-directory input overrides manifest outputDirectory', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
    INPUT_OUTPUT_DIRECTORY: 'custom/subgraphs',
    INPUT_INPUT_DIRECTORY: 'custom/subgraphs',
  });

  writeJson(path.join(root, 'gateway-release.json'), {
    outputDirectory: 'ignored/by/input',
    subgraphs: [
      {
        name: 'inventory',
        repository: 'Now-Micro/inventory',
        releaseTag: 'v9.9.9',
        assetName: 'inventory.fsp',
      },
    ],
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  assert.ok(fs.existsSync(path.join(root, 'custom', 'subgraphs', 'inventory', 'inventory.fsp')));
});

test('fails when dotnet is unavailable', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root);

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (call.command === 'dotnet' && call.args[0] === '--version') {
        return { error: new Error('ENOENT') };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /dotnet/i);
});

test('fails when local dotnet tool manifest does not exist', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_DOTNET_TOOLS_MANIFEST_PATH: '.config/missing-tools.json',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Local tool manifest/);
});

test('fails when verify fusion command returns non-zero', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root);

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (
        call.command === 'dotnet' &&
        call.args[0] === 'tool' &&
        call.args[1] === 'run' &&
        call.args[2] === 'fusion' &&
        call.args[3] === '--'
      ) {
        return { status: 1 };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /fusion/i);
});

test('skips fusion verification when verify-fusion-command is false', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_VERIFY_FUSION_COMMAND: 'false',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  const helpCalls = result.spawnCalls.filter(c =>
    c.command === 'dotnet' && c.args[0] === 'tool' && c.args[1] === 'run' && c.args[2] === 'fusion' && c.args[3] === '--'
  );
  assert.strictEqual(helpCalls.length, 0);
});

test('skips dotnet tool restore when run-dotnet-tool-restore is false', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RUN_DOTNET_TOOL_RESTORE: 'false',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  const restoreCalls = result.spawnCalls.filter(c =>
    c.command === 'dotnet' && c.args[0] === 'tool' && c.args[1] === 'restore'
  );
  assert.strictEqual(restoreCalls.length, 0);
});

test('fails when restore mode is enabled and manifest file is missing', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
    INPUT_MANIFEST_PATH: 'missing.json',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Failed to read manifest/);
});

test('fails when restore mode is enabled and manifest JSON is invalid', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
  });
  fs.writeFileSync(path.join(root, 'gateway-release.json'), '{ malformed json');

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Failed to parse manifest JSON/);
});

test('fails when restore mode is enabled and gh is unavailable', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
  });

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (call.command === 'gh' && call.args[0] === '--version') {
        return { error: new Error('ENOENT') };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /GitHub CLI/);
});

test('fails when manifest subgraph entry is missing required fields', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
  });

  writeJson(path.join(root, 'gateway-release.json'), {
    outputDirectory: 'artifacts/subgraphs',
    subgraphs: [{ name: 'accounts' }],
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /must include name, repository, releaseTag, and assetName/);
});

test('fails when downloaded gh asset path does not exist', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
  });

  writeJson(path.join(root, 'gateway-release.json'), {
    outputDirectory: 'artifacts/subgraphs',
    subgraphs: [
      {
        name: 'users',
        repository: 'Now-Micro/users',
        releaseTag: 'v1.0.0',
        assetName: 'users.fsp',
      },
    ],
  });

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (call.command === 'gh' && call.args[0] === 'release' && call.args[1] === 'download') {
        return { status: 0 };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Expected downloaded asset/);
});

test('fails when input directory does not exist', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_INPUT_DIRECTORY: 'does-not-exist',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Input directory/);
});

test('fails when no subgraph files match extension', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_SUBGRAPH_FILE_EXTENSION: '.zip',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /No '.zip' files/);
});

test('fails when output file input is empty', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_OUTPUT_FILE: '   ',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /output-file/);
});

test('fails when manifest path input is empty', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_MANIFEST_PATH: '   ',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /manifest-path/);
});

test('fails when subgraph extension does not start with dot', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_SUBGRAPH_FILE_EXTENSION: 'fsp',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /must start with a dot/);
});

test('debug mode logs subgraph files', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_DEBUG_MODE: 'true',
  });

  const result = runWithEnv(env);

  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stdout, /\[compose\] Found 2 subgraph files/);
});

test('compose command failure exits 1', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root);

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (
        call.command === 'dotnet' &&
        call.args[0] === 'tool' &&
        call.args[1] === 'run' &&
        call.args[2] === 'fusion' &&
        call.args[3] === 'compose'
      ) {
        return { status: 2 };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Fusion compose failed/);
});

test('restore download failure exits 1', () => {
  const root = makeTempDir();
  const env = createValidEnvironment(root, {
    INPUT_RESTORE_SUBGRAPH_ARTIFACTS: 'true',
  });

  writeJson(path.join(root, 'gateway-release.json'), {
    outputDirectory: 'artifacts/subgraphs',
    subgraphs: [
      {
        name: 'users',
        repository: 'Now-Micro/users',
        releaseTag: 'v1.0.0',
        assetName: 'users.fsp',
      },
    ],
  });

  const result = runWithEnv(env, {
    spawnHook: (call) => {
      if (call.command === 'gh' && call.args[0] === 'release' && call.args[1] === 'download') {
        return { status: 1 };
      }
      return null;
    },
  });

  assert.strictEqual(result.exitCode, 1);
  assert.match(result.stderr, /Failed downloading/);
});
