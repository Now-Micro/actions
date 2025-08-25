const fs = require('fs');
const path = require('path');

let projectFound, solutionFound;
let debug = false;

function dlog(msg) {
  if (debug) console.log(`[DEBUG] ${msg}`);
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
    if (findSolution && entry.isFile() && entry.name.endsWith('.sln')) { solutionFound = full; console.log(`Found solution: ${solutionFound}`); }
    if (findProject && entry.isFile() && entry.name.endsWith('.csproj')) { projectFound = full; console.log(`Found project: ${projectFound}`); }
    if (entry.isDirectory() && !(solutionFound && projectFound)) walk(full, maxDepth, findSolution, findProject, currentDepth + 1);
    if (solutionFound && projectFound) break;
  }
}

// New BFS search to prioritize shallower matches
function searchBFS(startDir, maxDepth, findSolution, findProject) {
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
      if (findSolution && !solutionFound && entry.name.endsWith('.sln')) {
        solutionFound = full;
      }
      if (findProject && !projectFound && entry.name.endsWith('.csproj')) {
        projectFound = full;
      }
      if (solutionFound && projectFound) break;
    }
    if (solutionFound && projectFound) break;
    // Second pass: enqueue directories
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const next = path.join(dir, entry.name);
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

    console.log(`Input directory: ${inputDir}`);
    console.log(`Max depth: ${maxDepth}`);
    console.log(`Find solution: ${findSolution}`);
    console.log(`Find project: ${findProject}`);
    dlog('Debug mode enabled');

    if (!inputDir) { console.error('Input directory is required.'); process.exit(1); }
    if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) { console.error(`Input directory does not exist or is not a directory: ${inputDir}`); process.exit(1); }

    const types = findSolution && findProject
      ? '.sln and .csproj'
      : findSolution
        ? '.sln'
        : findProject
          ? '.csproj'
          : 'no file types';
    console.log(`Searching for ${types} in ${inputDir} (max depth: ${maxDepth})...`);
    searchBFS(inputDir, maxDepth, findSolution, findProject);

    if (findProject) {
      console.log(`Project found: ${projectFound || 'None'}`);
    }
    if (findSolution) {
      console.log(`Solution found: ${solutionFound || 'None'}`);
    }

    if (githubOutput) {
      if (solutionFound && solutionFound.endsWith('.sln')) {
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

module.exports = { run, walk, searchBFS };
