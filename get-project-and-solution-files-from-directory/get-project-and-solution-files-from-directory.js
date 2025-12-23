const fs = require('fs');
const path = require('path');

let projectFound, solutionFound;
let debug = false;

const solutionExtensions = ['.sln', '.slnx'];

function isSolutionFile(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return solutionExtensions.some(ext => lower.endsWith(ext));
}

function dlog(msg) {
  if (debug) console.log(`[DEBUG] ${msg}`);
}

function displayRegex(pat) {
  try {
    return String(pat)
      .replace(/^\^+/, '') // remove leading anchors for display
      .replace(/(\\\.\*)+/g, ''); // remove repeated \.\*
  } catch { return String(pat); }
}

// Legacy DFS walk kept for potential reuse/testing
function walk(dir, maxDepth, findSolution, findProject, currentDepth = 0) {
  dlog(`(DFS) Entering walk: dir='${dir}' depth=${currentDepth}/${maxDepth} findSolution=${findSolution} findProject=${findProject}`);
  if (currentDepth > maxDepth) return;
  if (solutionFound && projectFound) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { console.error(`Cannot read directory: ${dir} (${e.message})`); return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (findSolution && entry.isFile() && isSolutionFile(entry.name)) { solutionFound = full; console.log(`Found solution: ${solutionFound}`); }
    if (findProject && entry.isFile() && entry.name.endsWith('.csproj')) { projectFound = full; console.log(`Found project: ${projectFound}`); }
    if (entry.isDirectory() && !(solutionFound && projectFound)) walk(full, maxDepth, findSolution, findProject, currentDepth + 1);
    if (solutionFound && projectFound) break;
  }
}

// New BFS search to prioritize shallower matches
function parseIgnored(input) {
  if (!input) return [];
  return String(input)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^\/+|\/+$/g, ''));
}

function pathHasIgnoredSegment(fullPath, ignored) {
  if (!ignored || ignored.length === 0) return false;
  const parts = fullPath.split(path.sep).filter(Boolean);
  return parts.some(p => ignored.includes(p));
}

function searchBFS(startDir, maxDepth, findSolution, findProject, projectNameRegex, solutionNameRegex, ignoredDirs) {
  const queue = [{ dir: startDir, depth: 0 }];
  while (queue.length && !(solutionFound && projectFound)) {
    const { dir, depth } = queue.shift();
    dlog(`(BFS) Visiting dir='${dir}' depth=${depth} maxDepth=${maxDepth}`);
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch (e) {
      console.error(`Cannot read directory: ${dir} (${e.message})`);
      continue;
    }
    // First pass: files at this depth
    for (const entry of entries) {
      dlog(`(BFS) Examining entry: ${entry.name}`);
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      if (pathHasIgnoredSegment(full, ignoredDirs)) { dlog(`(BFS) Skipping ignored file path: ${full}`); continue; }
      if (findSolution && !solutionFound && isSolutionFile(entry.name)) {
        const okSln = solutionNameRegex ? solutionNameRegex.test(entry.name) : true;
        if (okSln) {
          solutionFound = full;
        }
      }
      if (findProject && !projectFound && entry.name.endsWith('.csproj')) {
        const ok = projectNameRegex ? projectNameRegex.test(entry.name) : true;
        if (ok) {
          projectFound = full;
        }
      }
      if (solutionFound && projectFound) break;
    }
    if (solutionFound && projectFound) break;
    // Second pass: enqueue directories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const next = path.join(dir, entry.name);
        if (pathHasIgnoredSegment(next, ignoredDirs)) { dlog(`(BFS) Skipping ignored dir: ${next}`); continue; }
        dlog(`(BFS) Enqueuing directory: ${next}`);
        queue.push({ dir: next, depth: depth + 1 });
      }
    }
  }
}

function run() {
  try {
    projectFound = undefined;
    solutionFound = undefined;
    debug = (process.env.INPUT_DEBUG_MODE || 'false').toLowerCase() === 'true';

    const rawDir = process.env.INPUT_DIRECTORY || '';
    const inputDir = rawDir ? (path.isAbsolute(rawDir) ? rawDir : path.resolve(rawDir)) : '';
    const maxDepth = parseInt(process.env.INPUT_MAX_DEPTH || '1', 10);
    const findSolution = (process.env.INPUT_FIND_SOLUTION || 'true').toLowerCase() === 'true';
    const findProject = (process.env.INPUT_FIND_PROJECT || 'false').toLowerCase() === 'true';
    const githubOutput = process.env.GITHUB_OUTPUT;
    const projectRegex = process.env.INPUT_PROJECT_REGEX || '';
    const solutionRegex = process.env.INPUT_SOLUTION_REGEX || '';
    const ignoredDirsCSV = process.env.INPUT_IGNORED_DIRECTORIES || '';
    const ignoredDirs = parseIgnored(ignoredDirsCSV);

    console.log(`Input directory: ${inputDir}`);
    console.log(`Max depth: ${maxDepth}`);
    console.log(`Find solution: ${findSolution}`);
    console.log(`Find project: ${findProject}`);
    if (projectRegex) console.log(`Project regex: ${displayRegex(projectRegex)}`);
    if (solutionRegex) console.log(`Solution regex: ${displayRegex(solutionRegex)}`);
    if (ignoredDirs.length) console.log(`Ignored directories: ${ignoredDirs.join(',')}`);
    dlog('Debug mode enabled');

    if (!inputDir) { console.error('Input directory is required.'); process.exit(1); }
    if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) { console.error(`Input directory does not exist or is not a directory: ${inputDir}`); process.exit(1); }

    // Prepare regex if provided
    let projectNameRegex;
    if (projectRegex) {
      try { projectNameRegex = new RegExp(projectRegex); }
      catch (e) { console.error(`Invalid project regex: ${e.message}`); process.exit(1); }
    }
    let solutionNameRegex;
    if (solutionRegex) {
      try { solutionNameRegex = new RegExp(solutionRegex); }
      catch (e) { console.error(`Invalid solution regex: ${e.message}`); process.exit(1); }
    }

    const solutionTypeLabel = solutionExtensions.join(' or ');
    const types = findSolution && findProject
      ? `${solutionTypeLabel} and .csproj`
      : findSolution
        ? solutionTypeLabel
        : findProject
          ? '.csproj'
          : 'no file types';
    console.log(`Searching for ${types} in ${inputDir} (max depth: ${maxDepth})...`);
    searchBFS(inputDir, maxDepth, findSolution, findProject, projectNameRegex, solutionNameRegex, ignoredDirs);

    if (findProject) {
      console.log(`Project found: ${projectFound || 'None'}`);
    }
    if (findSolution) {
      console.log(`Solution found: ${solutionFound || 'None'}`);
    }

    if (githubOutput) {
      if (solutionFound && isSolutionFile(solutionFound)) {
        dlog(`Writing solution-found output: ${solutionFound}`);
        fs.appendFileSync(githubOutput, `solution-found=${solutionFound}\n`);
        fs.appendFileSync(githubOutput, `solution-name=${path.basename(solutionFound)}\n`);
      }
      if (projectFound && projectFound.endsWith('.csproj')) {
        dlog(`Writing project-found output: ${projectFound}`);
        fs.appendFileSync(githubOutput, `project-found=${projectFound}\n`);
        fs.appendFileSync(githubOutput, `project-name=${path.basename(projectFound)}\n`);
      }
    } else { console.error('GITHUB_OUTPUT not set; cannot write outputs'); process.exit(1); }
  } catch (err) {
    console.error('Error:', err.message);
    if (debug) console.error(err.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  run();
}

module.exports = { run, walk, searchBFS, parseIgnored, pathHasIgnoredSegment };
