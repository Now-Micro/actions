const fs = require('fs');
const path = require('path');

function exitWith(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    exitWith(`Failed to read or parse ${filePath}: ${error.message}`);
  }
}

function resolveWorkspaceRoot() {
  const workingDirectory = process.env.INPUT_WORKING_DIRECTORY || '';
  return workingDirectory ? path.resolve(workingDirectory) : process.cwd();
}

function run() {
  const workspaceRoot = resolveWorkspaceRoot();
  const templatePath = path.join(__dirname, 'dotnet-tools.json');
  const targetPath = path.join(workspaceRoot, '.config', 'dotnet-tools.json');

  if (!fs.existsSync(templatePath)) {
    exitWith(`Missing Fusion tool template: ${templatePath}`);
  }

  const template = readJson(templatePath);
  const targetExists = fs.existsSync(targetPath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });

  if (!targetExists) {
    fs.writeFileSync(targetPath, JSON.stringify(template, null, 2) + '\n');
    console.log(`Created ${targetPath} with Fusion tool support.`);
    return;
  }

  const current = readJson(targetPath);
  if (!current.tools) {
    current.tools = {};
  }

  if (current.tools['hotchocolate.fusion.commandline']) {
    current.tools['hotchocolate.fusion.commandline'].version = template.tools['hotchocolate.fusion.commandline'].version;
    fs.writeFileSync(targetPath, JSON.stringify(current, null, 2) + '\n');
    console.log(`Fusion tool already present in ${targetPath}.`);
    return;
  }

  current.tools['hotchocolate.fusion.commandline'] = template.tools['hotchocolate.fusion.commandline'];
  fs.writeFileSync(targetPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`Added Fusion tool definition to ${targetPath}.`);
}

if (require.main === module) run();

module.exports = { run };