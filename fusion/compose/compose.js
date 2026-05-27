const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function parseBool(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function exitWith(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function logDebug(enabled, message) {
  if (enabled) {
    console.log(`[compose] ${message}`);
  }
}

function resolveBaseDirectory() {
  const configured = (process.env.INPUT_WORKING_DIRECTORY || '').trim();
  return configured ? path.resolve(configured) : process.cwd();
}

function resolveFrom(baseDirectory, candidate) {
  return path.isAbsolute(candidate) ? candidate : path.resolve(baseDirectory, candidate);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw result.error;
  }
  return result;
}

function ensureCommandAvailable(command, argsForVersion, friendlyName) {
  try {
    const result = runCommand(command, argsForVersion, {
      stdio: 'ignore',
      env: process.env,
    });
    if (result.status !== 0) {
      exitWith(`${friendlyName} is required but was not found on PATH.`);
    }
  } catch (error) {
    exitWith(`${friendlyName} is required but was not found on PATH. ${error.message}`);
  }
}

function readManifestJson(manifestPath) {
  let raw;
  try {
    raw = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    exitWith(`Failed to read manifest file '${manifestPath}': ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    exitWith(`Failed to parse manifest JSON '${manifestPath}': ${error.message}`);
  }
}

function parseInlineManifestJson(rawInlineJson) {
  try {
    return JSON.parse(rawInlineJson);
  } catch (error) {
    exitWith(`Failed to parse inline JSON from input "subgraph-artifacts-json": ${error.message}`);
  }
}

function loadRestoreManifest(options) {
  const { inlineManifestJson, manifestPath } = options;
  const inlineValue = (inlineManifestJson || '').trim();

  if (inlineValue) {
    return {
      manifest: parseInlineManifestJson(inlineValue),
      source: 'input "subgraph-artifacts-json"',
    };
  }

  if (!manifestPath) {
    exitWith('Input "manifest-path" or "subgraph-artifacts-json" is required.');
  }

  return {
    manifest: readManifestJson(manifestPath),
    source: `manifest '${manifestPath}'`,
  };
}

function parseGatewayFileName(manifest, source) {
  if (!Object.prototype.hasOwnProperty.call(manifest, 'gatewayFileName')) {
    return '';
  }

  if (typeof manifest.gatewayFileName !== 'string') {
    exitWith(`${source} field "gatewayFileName" must be a string when provided.`);
  }

  const gatewayFileName = manifest.gatewayFileName.trim();
  if (!gatewayFileName) {
    return '';
  }

  const baseName = path.basename(gatewayFileName);
  if (baseName !== gatewayFileName) {
    exitWith(`${source} field "gatewayFileName" must be a file name only (no directory segments).`);
  }

  return gatewayFileName;
}

function collectSubgraphFiles(directoryPath, extension) {
  const discovered = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(extension)) {
        discovered.push(fullPath);
      }
    }
  }

  walk(directoryPath);
  return discovered;
}

function restoreSubgraphArtifacts(options) {
  const {
    debugMode,
    baseDirectory,
    manifestPath,
    inlineManifestJson,
    configuredOutputDirectory,
    ghToken,
  } = options;

  ensureCommandAvailable('gh', ['--version'], 'GitHub CLI (gh)');

  const { manifest, source } = loadRestoreManifest({
    inlineManifestJson,
    manifestPath,
  });
  const gatewayFileName = parseGatewayFileName(manifest, source);
  const manifestOutputDirectory = typeof manifest.outputDirectory === 'string' ? manifest.outputDirectory.trim() : '';
  const outputDirectorySetting = configuredOutputDirectory || manifestOutputDirectory;

  if (!outputDirectorySetting) {
    exitWith('No output directory specified. Set input "output-directory" or provide manifest.outputDirectory.');
  }

  const outputDirectory = resolveFrom(baseDirectory, outputDirectorySetting);
  fs.mkdirSync(outputDirectory, { recursive: true });

  if (!Array.isArray(manifest.subgraphs)) {
    exitWith(`${source} must contain a "subgraphs" array.`);
  }

  const commandEnvironment = ghToken
    ? { ...process.env, GH_TOKEN: ghToken }
    : process.env;

  for (const [index, subgraph] of manifest.subgraphs.entries()) {
    if (!subgraph || typeof subgraph !== 'object') {
      exitWith(`${source} subgraphs[${index}] must be an object.`);
    }

    const subgraphName = String(subgraph.name || '').trim();
    const subgraphRepository = String(subgraph.repository || '').trim();
    const subgraphReleaseTag = String(subgraph.releaseTag || '').trim();
    const subgraphAssetName = String(subgraph.assetName || '').trim();

    if (!subgraphName || !subgraphRepository || !subgraphReleaseTag || !subgraphAssetName) {
      exitWith(`${source} subgraphs[${index}] must include name, repository, releaseTag, and assetName.`);
    }

    const stagingDirectory = path.join(outputDirectory, subgraphName);
    fs.mkdirSync(stagingDirectory, { recursive: true });

    logDebug(debugMode, `Downloading ${subgraphAssetName} from ${subgraphRepository}@${subgraphReleaseTag}`);

    const downloadResult = runCommand(
      'gh',
      [
        'release',
        'download',
        subgraphReleaseTag,
        '--repo',
        subgraphRepository,
        '--pattern',
        subgraphAssetName,
        '--dir',
        stagingDirectory,
        '--clobber',
      ],
      {
        stdio: 'inherit',
        cwd: baseDirectory,
        env: commandEnvironment,
      }
    );

    if (downloadResult.status !== 0) {
      exitWith(`Failed downloading '${subgraphAssetName}' from '${subgraphRepository}' at '${subgraphReleaseTag}'.`);
    }

    const downloadedAssetPath = path.join(stagingDirectory, subgraphAssetName);
    if (!fs.existsSync(downloadedAssetPath)) {
      exitWith(`Expected downloaded asset '${downloadedAssetPath}' was not found.`);
    }
  }

  return {
    outputDirectory,
    gatewayFileName,
  };
}

function composeGateway(options) {
  const {
    baseDirectory,
    debugMode,
    inputDirectory,
    outputFile,
    subgraphFileExtension,
  } = options;

  if (!fs.existsSync(inputDirectory) || !fs.statSync(inputDirectory).isDirectory()) {
    exitWith(`Input directory '${inputDirectory}' does not exist.`);
  }

  const subgraphFiles = collectSubgraphFiles(inputDirectory, subgraphFileExtension);
  if (subgraphFiles.length === 0) {
    exitWith(`No '${subgraphFileExtension}' files were found under '${inputDirectory}'.`);
  }

  logDebug(debugMode, `Found ${subgraphFiles.length} subgraph files.`);
  for (const subgraphFile of subgraphFiles) {
    logDebug(debugMode, `subgraph file: ${subgraphFile}`);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const composeArgs = ['tool', 'run', 'fusion', 'compose', '-p', outputFile];
  for (const subgraphFile of subgraphFiles) {
    composeArgs.push('-s', subgraphFile);
  }

  const composeResult = runCommand('dotnet', composeArgs, {
    stdio: 'inherit',
    cwd: baseDirectory,
    env: process.env,
  });

  if (composeResult.status !== 0) {
    exitWith('Fusion compose failed.');
  }

  if (!fs.existsSync(outputFile)) {
    exitWith(`Expected composed output '${outputFile}' was not created.`);
  }

  return { subgraphCount: subgraphFiles.length };
}

function run() {
  const debugMode = parseBool(process.env.INPUT_DEBUG_MODE, false);
  const runDotnetToolRestore = parseBool(process.env.INPUT_RUN_DOTNET_TOOL_RESTORE, true);
  const verifyFusionCommand = parseBool(process.env.INPUT_VERIFY_FUSION_COMMAND, true);

  const baseDirectory = resolveBaseDirectory();
  const dotnetToolsManifestInput = (process.env.INPUT_DOTNET_TOOLS_MANIFEST_PATH || '.config/dotnet-tools.json').trim();
  const manifestPathInput = (process.env.INPUT_MANIFEST_PATH || '').trim();
  const subgraphArtifactsJsonInput = (process.env.INPUT_SUBGRAPH_ARTIFACTS_JSON || '').trim();
  const configuredOutputDirectory = (process.env.INPUT_OUTPUT_DIRECTORY || '').trim();
  const inputDirectoryInput = (process.env.INPUT_INPUT_DIRECTORY || 'artifacts/subgraphs').trim();
  const outputFileInput = (process.env.INPUT_OUTPUT_FILE || '').trim();
  const subgraphFileExtension = (process.env.INPUT_SUBGRAPH_FILE_EXTENSION || '.fsp').trim();
  const ghToken = (process.env.INPUT_GH_TOKEN || '').trim();
  const githubOutput = process.env.GITHUB_OUTPUT || '';

  if (!outputFileInput) {
    exitWith('Input "output-file" is required.');
  }

  if (!subgraphFileExtension.startsWith('.')) {
    exitWith('Input "subgraph-file-extension" must start with a dot. Example: .fsp');
  }

  ensureCommandAvailable('dotnet', ['--version'], '.NET SDK (dotnet)');

  const dotnetToolsManifestPath = resolveFrom(baseDirectory, dotnetToolsManifestInput);
  if (!fs.existsSync(dotnetToolsManifestPath)) {
    exitWith(`Local tool manifest '${dotnetToolsManifestPath}' was not found.`);
  }

  if (runDotnetToolRestore) {
    const restoreResult = runCommand('dotnet', ['tool', 'restore'], {
      stdio: 'inherit',
      cwd: baseDirectory,
      env: process.env,
    });
    if (restoreResult.status !== 0) {
      exitWith('dotnet tool restore failed.');
    }
  }

  if (verifyFusionCommand) {
    const fusionHelpResult = runCommand('dotnet', ['tool', 'run', 'fusion', '--', '--help'], {
      stdio: 'ignore',
      cwd: baseDirectory,
      env: process.env,
    });
    if (fusionHelpResult.status !== 0) {
      exitWith('Local tool "fusion" is not runnable. Ensure dotnet tool restore succeeded.');
    }
  }

  const manifestPath = manifestPathInput ? resolveFrom(baseDirectory, manifestPathInput) : '';

  const restoreResult = restoreSubgraphArtifacts({
    debugMode,
    baseDirectory,
    manifestPath,
    inlineManifestJson: subgraphArtifactsJsonInput,
    configuredOutputDirectory,
    ghToken,
  });
  const restoreOutputDirectory = restoreResult.outputDirectory;

  const inputDirectory = resolveFrom(
    baseDirectory,
    inputDirectoryInput || restoreOutputDirectory || 'artifacts/subgraphs'
  );
  const requestedOutputFile = resolveFrom(baseDirectory, outputFileInput);
  const outputFile = restoreResult.gatewayFileName
    ? path.join(path.dirname(requestedOutputFile), restoreResult.gatewayFileName)
    : requestedOutputFile;

  logDebug(debugMode, `base directory: ${baseDirectory}`);
  logDebug(debugMode, `manifest path: ${manifestPath}`);
  logDebug(debugMode, `input directory: ${inputDirectory}`);
  if (restoreResult.gatewayFileName) {
    logDebug(debugMode, `gateway file name override from manifest: ${restoreResult.gatewayFileName}`);
  }
  logDebug(debugMode, `output file: ${outputFile}`);

  const composeResult = composeGateway({
    baseDirectory,
    debugMode,
    inputDirectory,
    outputFile,
    subgraphFileExtension,
  });

  if (githubOutput) {
    fs.appendFileSync(githubOutput, `input-directory=${inputDirectory}\n`);
    fs.appendFileSync(githubOutput, `output-file=${outputFile}\n`);
    fs.appendFileSync(githubOutput, `subgraph-count=${composeResult.subgraphCount}\n`);
  }

  console.log(`[compose] composed ${composeResult.subgraphCount} subgraphs into ${outputFile}`);
}

if (require.main === module) {
  run();
}

module.exports = {
  collectSubgraphFiles,
  composeGateway,
  parseBool,
  readManifestJson,
  resolveFrom,
  restoreSubgraphArtifacts,
  run,
};