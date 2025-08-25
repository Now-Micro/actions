const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, ensureEnforceCodeStyleTrue } = require('./update-csproj-file');

function withEnv(env, fn) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  let out = '', err = '';
  let exitCode = 0;
  const so = process.stdout.write, se = process.stderr.write;
  const origExit = process.exit;
  process.stdout.write = (c, e, cb) => { out += c; return so.call(process.stdout, c, e, cb); };
  process.stderr.write = (c, e, cb) => { err += c; return se.call(process.stderr, c, e, cb); };
  process.exit = c => { exitCode = c || 0; throw new Error(`__EXIT_${exitCode}__`); };
  try { try { fn(); } catch (e) { if (!/^__EXIT_/.test(e.message)) throw e; } } finally { process.env = prev; process.stdout.write = so; process.stderr.write = se; process.exit = origExit; }
  return { out, err, exitCode };
}

function makeProj(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-'));
  const file = path.join(dir, 'App.csproj');
  fs.writeFileSync(file, content, 'utf8');
  return { dir, file };
}

const baseProj = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
</Project>
`;

const defaultInclude = '..\\..\\CodeStandards.Analyzers$\\Demo.Analyzers\\Demo.Analyzers.csproj';
const customInclude = '..\\..\\Custom.Analyzers$\\Demo.Analyzers\\Demo.Analyzers.csproj';

// New tests: EnforceCodeStyleInBuild handling

test('ensure updates EnforceCodeStyleInBuild=false to true', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild>\n  </PropertyGroup>\n</Project>\n`;
  const res = ensureEnforceCodeStyleTrue(xml);
  assert.ok(res.changed);
  assert.match(res.updated, /<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>/);
});

test('ensure inserts EnforceCodeStyleInBuild into first PropertyGroup when missing', () => {
  const xml = baseProj;
  const res = ensureEnforceCodeStyleTrue(xml);
  assert.ok(res.changed);
  assert.match(res.updated, /<PropertyGroup>[\s\S]*<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>[\s\S]*<\/PropertyGroup>/);
});

test('ensure adds PropertyGroup with EnforceCodeStyle when none exist', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<Project Sdk="Microsoft.NET.Sdk">\n</Project>`;
  const res = ensureEnforceCodeStyleTrue(xml);
  assert.ok(res.changed);
  assert.match(res.updated, /<PropertyGroup>[\s\S]*<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>[\s\S]*<\/PropertyGroup>/);
});

test('run updates file with EnforceCodeStyleInBuild present but not true', () => {
  const { file } = makeProj(`<?xml version="1.0" encoding="utf-8"?>\n<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <EnforceCodeStyleInBuild>off</EnforceCodeStyleInBuild>\n  </PropertyGroup>\n</Project>`);
  withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.match(updated, /<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>/);
});

test('run inserts EnforceCodeStyleInBuild when missing and also injects analyzer', () => {
  const { file } = makeProj(baseProj);
  withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.match(updated, /<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>/);
  assert.match(updated, /OutputItemType="Analyzer"/);
});

test('missing project file path exits 1', () => {
  const r = withEnv({ INPUT_PROJECT_FILE: '', INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.out + r.err, /No project file found/);
});

test('non-existent project file exits 1', () => {
  const r = withEnv({ INPUT_PROJECT_FILE: path.join(os.tmpdir(), 'nope.csproj'), INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.out + r.err, /No project file found/);
});

test('missing include path exits 1', () => {
  const { file } = makeProj(baseProj);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: '' }, () => run());
  assert.strictEqual(r.exitCode, 1);
  assert.match(r.out + r.err, /No include path provided/);
});

test('inserts ItemGroup before </Project> (explicit include)', () => {
  const { file } = makeProj(baseProj);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_CODE_ANALYZERS_NAME: 'CodeStandards.Analyzers', INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.match(updated, /<ItemGroup>[\s\S]*<ProjectReference[\s\S]*OutputItemType="Analyzer"[\s\S]*<\/ItemGroup>[\s\S]*<\/Project>/);
  const expectedInclude = `Include="${defaultInclude}"`;
  assert.ok(updated.includes(expectedInclude), `Include path not found. Expected to contain: ${expectedInclude}\nActual:\n${updated}`);
  assert.match(r.out, /Inserted Analyzer ProjectReference/);
});

test('inserts ItemGroup using explicit INPUT_INCLUDE_PATH', () => {
  const { file } = makeProj(baseProj);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_CODE_ANALYZERS_NAME: 'IGNORED', INPUT_INCLUDE_PATH: customInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  const expectedInclude = `Include="${customInclude}"`;
  assert.ok(updated.includes(expectedInclude), `Include path not found. Expected to contain: ${expectedInclude}\nActual:\n${updated}`);
  assert.ok(!updated.includes('CodeStandards.Analyzers$'), 'Fallback include used unexpectedly');
});

test('inserts even if already present by OutputItemType attribute', () => {
  const { file } = makeProj(`<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="${defaultInclude}" OutputItemType="Analyzer" ReferenceOutputAssembly="false" />
  </ItemGroup>
</Project>`);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  // Existing analyzer reference is removed first, then one is inserted
  const occurrences = (updated.match(/OutputItemType="Analyzer"/g) || []).length;
  assert.strictEqual(occurrences, 1);
  assert.match(r.out, /Inserted Analyzer ProjectReference/);
});

test('inserts even if explicit INPUT_INCLUDE_PATH already present', () => {
  const { file } = makeProj(`<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="${customInclude}" />
  </ItemGroup>
</Project>`);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: customInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  const includeOccurrences = updated.split(`Include="${customInclude}"`).length - 1;
  assert.strictEqual(includeOccurrences, 2);
  assert.match(updated, /OutputItemType="Analyzer"/);
  assert.match(r.out, /Inserted Analyzer ProjectReference/);
});

test('inserts even if include path already present without OutputItemType', () => {
  const { file } = makeProj(`<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <ProjectReference Include="${defaultInclude}" />
  </ItemGroup>
</Project>`);
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  const includeOccurrences = updated.split(`Include="${defaultInclude}"`).length - 1;
  assert.strictEqual(includeOccurrences, 2);
  const analyzerOccurrences = (updated.match(/OutputItemType="Analyzer"/g) || []).length;
  assert.strictEqual(analyzerOccurrences, 1);
  assert.match(r.out, /Inserted Analyzer ProjectReference/);
});

test('appends at end if </Project> missing', () => {
  const { file } = makeProj('<Project></Nope>');
  const r = withEnv({ INPUT_PROJECT_FILE: file, INPUT_CODE_ANALYZERS_NAME: 'CodeStandards.Analyzers', INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.match(updated, /<ItemGroup>[\s\S]*OutputItemType="Analyzer"/);
});

test('commented EnforceCodeStyleInBuild is removed and a new one is inserted', () => {
  const commented = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <!-- <EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild> -->
  </PropertyGroup>
</Project>`;
  const { file } = makeProj(commented);
  withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.ok(!updated.includes('<!-- <EnforceCodeStyleInBuild>false</EnforceCodeStyleInBuild> -->'));
  assert.match(updated, /<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>/);
});

test('commented Analyzer ProjectReference is removed and a new one is inserted', () => {
  const commented = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <!-- <ProjectReference Include="${defaultInclude}" OutputItemType="Analyzer" ReferenceOutputAssembly="false" /> -->
  </ItemGroup>
</Project>`;
  const { file } = makeProj(commented);
  withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.ok(!updated.includes(`<!-- <ProjectReference Include="${defaultInclude}`));
  assert.ok(updated.includes(`Include="${defaultInclude}"`));
  assert.ok(updated.includes('OutputItemType="Analyzer"'));
  const prCount = (updated.match(/<ProjectReference\b/g) || []).length;
  assert.strictEqual(prCount, 1);
});

test('commented EnforceCodeStyleInBuild true is removed and a new one is inserted', () => {
  const commented = `<?xml version="1.0" encoding="utf-8"?>
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <!-- <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild> -->
  </PropertyGroup>
</Project>`;
  const { file } = makeProj(commented);
  withEnv({ INPUT_PROJECT_FILE: file, INPUT_INCLUDE_PATH: defaultInclude }, () => run());
  const updated = fs.readFileSync(file, 'utf8');
  assert.ok(!updated.includes('<!-- <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild> -->'));
  const lineStartTrue = /(?:^|\r?\n)[ \t]*<EnforceCodeStyleInBuild>true<\/EnforceCodeStyleInBuild>/;
  assert.match(updated, lineStartTrue);
});
