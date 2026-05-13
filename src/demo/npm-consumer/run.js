'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const readline = require('node:readline');
const os = require('node:os');
const path = require('node:path');

function runCommand(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname),
    ...options,
  });
}

function getNpmInvoker() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return {
      command: process.execPath,
      argsPrefix: [npmExecPath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    argsPrefix: [],
  };
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    const output = process.stdout;

    if (!input.isTTY || !output.isTTY) {
      reject(new Error('An interactive terminal is required to enter the auth token.'));
      return;
    }

    output.write(question);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    let value = '';

    const cleanup = () => {
      input.setRawMode(false);
      input.pause();
      input.removeListener('data', onData);
    };

    const onData = chunk => {
      const char = chunk;

      if (char === '\r' || char === '\n' || char === '\u000d') {
        output.write('\n');
        cleanup();
        resolve(value.trim());
        return;
      }

      if (char === '\u0003') {
        cleanup();
        reject(new Error('Token entry cancelled.'));
        return;
      }

      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    input.on('data', onData);
  });
}

async function getAuthToken() {
  const existingToken = (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN || '').trim();
  if (existingToken) {
    return existingToken;
  }

  return promptHidden('GitHub Packages auth token: ');
}

async function createNpmConfigFile() {
  const registry = 'https://npm.pkg.github.com';
  const token = await getAuthToken();
  const configPath = path.join(os.tmpdir(), `npm-consumer-${process.pid}.npmrc`);

  const lines = [
    `@now-micro:registry=${registry}`,
    `registry=${registry}`,
  ];

  if (token) {
    lines.push(`//npm.pkg.github.com/:_authToken=${token}`);
  }

  fs.writeFileSync(configPath, lines.join('\n') + '\n', 'utf8');
  return configPath;
}

async function run() {
  const npmInvoker = getNpmInvoker();
  const userConfig = await createNpmConfigFile();
  const env = { ...process.env, npm_config_userconfig: userConfig };

  console.log('Installing published package...');
  runCommand(npmInvoker.command, [...npmInvoker.argsPrefix, 'install'], { env });

  console.log('Verifying exported functions...');
  runCommand(npmInvoker.command, [...npmInvoker.argsPrefix, 'run', 'verify'], { env });

  console.log('Done.');
}

if (require.main === module) {
  run().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { run };