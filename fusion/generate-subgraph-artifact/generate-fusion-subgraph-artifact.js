const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let debug = false;

function dlog(msg) {
  if (debug) console.log(`🔍 ${msg}`);
}

function dlogFileContents(filePath, content) {
  if (!debug) return;
  dlog(`Generated file: ${filePath}`);
  dlog(`Contents of ${filePath}:`);
  console.log(content);
}

function exitWith(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function runDotnet(args, execOpts) {
  const result = spawnSync('dotnet', args, execOpts);
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function sanitizeRunId(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return 'local';
  }

  // Restrict to safe path-segment characters to avoid traversal/path injection.
  if (/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    return trimmed;
  }

  return 'local';
}

function run() {
  debug = (process.env.INPUT_DEBUG_MODE || 'false').toLowerCase() === 'true';

  const artifactVersion = (process.env.INPUT_ARTIFACT_VERSION || '').trim();
  const commitSha = (process.env.INPUT_COMMIT_SHA || '').trim() || (process.env.GITHUB_SHA || '').trim();
  const githubOutput = process.env.GITHUB_OUTPUT || '';
  const projectPath = (process.env.INPUT_PROJECT_PATH || '').trim();
  const rawSchemaDir = (process.env.INPUT_SCHEMA_DIR || '').trim();
  const rawRunId = (process.env.GITHUB_RUN_ID || '').trim();
  const runId = sanitizeRunId(rawRunId);
  const runnerTemp = (process.env.RUNNER_TEMP || '').trim();
  const sourceRepoUrl = (process.env.INPUT_SOURCE_REPO_URL || '').trim();
  const subgraphHttpUrl = (process.env.INPUT_SUBGRAPH_HTTP_URL || 'http://localhost:4000').trim() || 'http://localhost:4000';
  const subgraphName = (process.env.INPUT_SUBGRAPH_NAME || '').trim();
  const workingDir = (process.env.INPUT_WORKING_DIRECTORY || '').trim();

  if (!artifactVersion) exitWith('Input "artifact-version" is required.');
  if (!rawSchemaDir) exitWith('Input "schema-dir" is required.');
  if (!subgraphName) exitWith('Input "subgraph-name" is required.');

  const baseDir = workingDir ? path.resolve(workingDir) : process.cwd();
  const resolvedWorkingDir = workingDir ? path.resolve(workingDir) : '';
  const schemaDir = path.resolve(baseDir, rawSchemaDir);
  const publishRoot = runnerTemp || os.tmpdir();
  const publishDir = path.resolve(publishRoot, 'now-micro-fusion-subgraph-artifacts', runId);
  const execOpts = { stdio: 'inherit', ...(resolvedWorkingDir ? { cwd: resolvedWorkingDir } : {}) };

  const schemaPath = path.join(schemaDir, 'schema.graphql');
  const configPath = path.join(schemaDir, 'subgraph-config.json');
  const extensionsPath = path.join(schemaDir, 'schema.extensions.graphql');
  const artifactPath = path.join(publishDir, `${subgraphName}.fsp`);
  const metadataPath = path.join(publishDir, `${subgraphName}.metadata.json`);

  dlog(`artifact-path:      ${artifactPath}`);
  dlog(`artifact-version:   ${artifactVersion}`);
  dlog(`commit-sha:         ${commitSha}`);
  dlog(`metadata-path:      ${metadataPath}`);
  dlog(`project-path:       ${projectPath}`);
  dlog(`publish-root:       ${publishRoot}`);
  dlog(`publish-dir:        ${publishDir}`);
  dlog(`schema-dir:         ${schemaDir}`);
  dlog(`schema-path:        ${schemaPath}`);
  dlog(`source-repo-url:    ${sourceRepoUrl}`);
  dlog(`subgraph-http-url:  ${subgraphHttpUrl}`);
  dlog(`subgraph-name:      ${subgraphName}`);
  dlog(`raw-run-id:         ${rawRunId || '(empty)'}`);
  dlog(`sanitized-run-id:   ${runId}`);
  dlog(`working-directory:  ${resolvedWorkingDir || '(default)'}`);

  // Create required directories
  dlog(`Creating directories: ${schemaDir}, ${publishDir}`);
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(publishDir, { recursive: true });

  // Restore dotnet tools
  dlog('Running dotnet tool restore.');
  runDotnet(['tool', 'restore'], execOpts);

  // Export schema from the project
  dlog('Running dotnet schema export.');

  if (projectPath) {
    dlog(`Using project path: ${projectPath}`);
    runDotnet(['run', '--project', projectPath, '--', 'schema', 'export', '--output', schemaPath], execOpts);
  } else {
    dlog('No project path provided, assuming schema is already present at schema path and skipping export step.');
  }

  if (!fs.existsSync(schemaPath)) {
    exitWith(`Schema file not found at ${schemaPath}. Provide project-path or pre-populate schema.graphql in schema-dir.`);
  }

  if (debug && fs.existsSync(schemaPath)) {
    dlogFileContents(schemaPath, fs.readFileSync(schemaPath, 'utf8'));
  }

  // Write subgraph config JSON
  const configContent = JSON.stringify({
    subgraph: subgraphName,
    http: {
      baseAddress: subgraphHttpUrl,
    },
  });
  dlog(`Writing subgraph config: ${configPath}`);
  fs.writeFileSync(configPath, configContent + '\n');
  dlogFileContents(configPath, fs.readFileSync(configPath, 'utf8'));

  // Configure subgraph HTTP endpoint
  dlog('Configuring Fusion subgraph HTTP endpoint.');
  runDotnet(['fusion', 'subgraph', 'config', 'set', 'http', '--url', subgraphHttpUrl, '-w', schemaDir], execOpts);

  // Pack the subgraph artifact (optionally include schema extensions)
  dlog(`Checking for schema extensions file at ${extensionsPath}`);
  const hasExtensions = fs.existsSync(extensionsPath);
  dlog(hasExtensions
    ? `Found schema extensions file: ${extensionsPath}`
    : `No schema extensions file found at ${extensionsPath}`);
  const packArgs = ['fusion', 'subgraph', 'pack', '-s', schemaPath, '-c', configPath, '-p', artifactPath];
  if (hasExtensions) {
    packArgs.push('-e', extensionsPath);
  } else {
    dlog('Skipping -e flag for Fusion pack.');
  }
  dlog(`Running Fusion pack with args: ${JSON.stringify(packArgs)}`);
  runDotnet(packArgs, execOpts);

  // Write metadata JSON
  const generationDateUtc = new Date().toISOString();
  const metadata = {
    subgraphName,
    artifactVersion,
    commitSha,
    sourceRepoUrl,
    generationDateUtc,
  };
  dlog(`Writing metadata: ${metadataPath}`);
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  dlogFileContents(metadataPath, fs.readFileSync(metadataPath, 'utf8'));

  // Write step outputs
  if (githubOutput) {
    fs.appendFileSync(githubOutput, `artifact-path=${artifactPath}\n`);
    fs.appendFileSync(githubOutput, `metadata-path=${metadataPath}\n`);
    fs.appendFileSync(githubOutput, `publish-dir=${publishDir}\n`);
    dlog('Outputs written to GITHUB_OUTPUT');
  }

  console.log(`✅ Fusion subgraph artifact generated: ${artifactPath}`);
  console.log(`✅ Metadata written: ${metadataPath}`);
}

if (require.main === module) run();

module.exports = { run };
