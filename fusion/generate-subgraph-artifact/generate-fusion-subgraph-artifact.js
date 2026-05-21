const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let debug = false;

function dlog(msg) {
  if (debug) console.log(`🔍 ${msg}`);
}

function exitWith(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function run() {
  debug = (process.env.INPUT_DEBUG_MODE || 'false').toLowerCase() === 'true';

  const projectPath     = process.env.INPUT_PROJECT_PATH     || '';
  const schemaDir       = process.env.INPUT_SCHEMA_DIR       || '';
  const publishDir      = process.env.INPUT_PUBLISH_DIR      || '';
  const subgraphName    = process.env.INPUT_SUBGRAPH_NAME    || '';
  const artifactVersion = process.env.INPUT_ARTIFACT_VERSION || '';
  const commitSha       = process.env.INPUT_COMMIT_SHA       || process.env.GITHUB_SHA || '';
  const sourceRepoUrl   = process.env.INPUT_SOURCE_REPO_URL  || '';
  const subgraphHttpUrl = process.env.INPUT_SUBGRAPH_HTTP_URL || 'http://localhost:4000';
  const workingDir      = process.env.INPUT_WORKING_DIRECTORY || '';
  const githubOutput    = process.env.GITHUB_OUTPUT          || '';

  if (!projectPath)     exitWith('Input "project-path" is required.');
  if (!schemaDir)       exitWith('Input "schema-dir" is required.');
  if (!publishDir)      exitWith('Input "publish-dir" is required.');
  if (!subgraphName)    exitWith('Input "subgraph-name" is required.');
  if (!artifactVersion) exitWith('Input "artifact-version" is required.');

  const execOpts = { stdio: 'inherit', ...(workingDir ? { cwd: workingDir } : {}) };

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
  dlog(`working-directory:  ${workingDir || '(default)'}`);
  dlog(`schema-path:        ${schemaPath}`);
  dlog(`artifact-path:      ${artifactPath}`);
  dlog(`metadata-path:      ${metadataPath}`);

  // Create required directories
  dlog(`Creating directories: ${schemaDir}, ${publishDir}`);
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(publishDir, { recursive: true });

  // Restore dotnet tools
  console.log('▶ dotnet tool restore');
  execSync('dotnet tool restore', execOpts);

  // Export schema from the project
  console.log(`▶ dotnet run --project "${projectPath}" -- schema export --output "${schemaPath}"`);
  execSync(`dotnet run --project "${projectPath}" -- schema export --output "${schemaPath}"`, execOpts);

  // Write subgraph config JSON
  const configContent = JSON.stringify({ subgraph: subgraphName });
  dlog(`Writing subgraph config: ${configPath}`);
  fs.writeFileSync(configPath, configContent + '\n');

  // Configure subgraph HTTP endpoint
  console.log(`▶ dotnet fusion subgraph config set http --url "${subgraphHttpUrl}" -w "${schemaDir}"`);
  execSync(`dotnet fusion subgraph config set http --url "${subgraphHttpUrl}" -w "${schemaDir}"`, execOpts);

  // Pack the subgraph artifact (optionally include schema extensions)
  const hasExtensions = fs.existsSync(extensionsPath);
  let packCmd = `dotnet fusion subgraph pack -s "${schemaPath}" -c "${configPath}" -p "${artifactPath}"`;
  if (hasExtensions) {
    packCmd += ` -e "${extensionsPath}"`;
    dlog(`Extensions file found: ${extensionsPath}`);
  } else {
    dlog(`No extensions file at ${extensionsPath} — skipping -e flag`);
  }
  console.log(`▶ ${packCmd}`);
  execSync(packCmd, execOpts);

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
