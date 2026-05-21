const fs = require('fs');
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

function run() {
  debug = (process.env.INPUT_DEBUG_MODE || 'false').toLowerCase() === 'true';

  const projectPath     = process.env.INPUT_PROJECT_PATH     || '';
  const rawSchemaDir    = process.env.INPUT_SCHEMA_DIR       || '';
  const rawPublishDir   = process.env.INPUT_PUBLISH_DIR      || '';
  const subgraphName    = process.env.INPUT_SUBGRAPH_NAME    || '';
  const artifactVersion = process.env.INPUT_ARTIFACT_VERSION || '';
  const commitSha       = process.env.INPUT_COMMIT_SHA       || process.env.GITHUB_SHA || '';
  const sourceRepoUrl   = process.env.INPUT_SOURCE_REPO_URL  || '';
  const subgraphHttpUrl = process.env.INPUT_SUBGRAPH_HTTP_URL || 'http://localhost:4000';
  const workingDir      = process.env.INPUT_WORKING_DIRECTORY || '';
  const githubOutput    = process.env.GITHUB_OUTPUT          || '';

  if (!projectPath)     exitWith('Input "project-path" is required.');
  if (!rawSchemaDir)    exitWith('Input "schema-dir" is required.');
  if (!rawPublishDir)   exitWith('Input "publish-dir" is required.');
  if (!subgraphName)    exitWith('Input "subgraph-name" is required.');
  if (!artifactVersion) exitWith('Input "artifact-version" is required.');

  const baseDir = workingDir ? path.resolve(workingDir) : process.cwd();
  const resolvedWorkingDir = workingDir ? path.resolve(workingDir) : '';
  const schemaDir = path.resolve(baseDir, rawSchemaDir);
  const publishDir = path.resolve(baseDir, rawPublishDir);
  const execOpts = { stdio: 'inherit', ...(resolvedWorkingDir ? { cwd: resolvedWorkingDir } : {}) };

  const schemaPath     = path.join(schemaDir, 'schema.graphql');
  const configPath     = path.join(schemaDir, 'subgraph-config.json');
  const extensionsPath = path.join(schemaDir, 'schema.extensions.graphql');
  const artifactPath   = path.join(publishDir, `${subgraphName}.fsp`);
  const metadataPath   = path.join(publishDir, `${subgraphName}.metadata.json`);

  dlog(`project-path:       ${projectPath}`);
  dlog(`schema-dir:         ${schemaDir}`);
  dlog(`publish-dir:        ${publishDir}`);
  dlog(`subgraph-name:      ${subgraphName}`);
  dlog(`artifact-version:   ${artifactVersion}`);
  dlog(`commit-sha:         ${commitSha}`);
  dlog(`source-repo-url:    ${sourceRepoUrl}`);
  dlog(`subgraph-http-url:  ${subgraphHttpUrl}`);
  dlog(`working-directory:  ${resolvedWorkingDir || '(default)'}`);
  dlog(`schema-path:        ${schemaPath}`);
  dlog(`artifact-path:      ${artifactPath}`);
  dlog(`metadata-path:      ${metadataPath}`);

  // Create required directories
  dlog(`Creating directories: ${schemaDir}, ${publishDir}`);
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(publishDir, { recursive: true });

  // Restore dotnet tools
  dlog('Running dotnet tool restore.');
  runDotnet(['tool', 'restore'], execOpts);

  // Export schema from the project
  dlog('Running dotnet schema export.');
  runDotnet(['run', '--project', projectPath, '--', 'schema', 'export', '--output', schemaPath], execOpts);
  if (debug && fs.existsSync(schemaPath)) {
    dlogFileContents(schemaPath, fs.readFileSync(schemaPath, 'utf8'));
  }

  // Write subgraph config JSON
  const configContent = JSON.stringify({ subgraph: subgraphName });
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
  dlog('Packing Fusion subgraph artifact.');
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
    dlog('Outputs written to GITHUB_OUTPUT');
  }

  console.log(`✅ Fusion subgraph artifact generated: ${artifactPath}`);
  console.log(`✅ Metadata written: ${metadataPath}`);
}

if (require.main === module) run();

module.exports = { run };
