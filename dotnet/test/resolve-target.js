const env = process.env;

function parseBool(value) {
    if (typeof value === 'string') {
        return ['1', 'true', 'yes'].includes(value.toLowerCase().trim());
    }
    return Boolean(value);
}

const projectFile = env.PROJECT_FILE?.trim();
const preferSolution = parseBool(env.PREFER_SOLUTION);
const projectFound = env.PROJECT_FOUND?.trim() || '';
const solutionFound = env.SOLUTION_FOUND?.trim() || '';

if (projectFile) {
    console.log(`path=${projectFile}`);
    process.exit(0);
}

let target = '';
if (preferSolution) {
    if (solutionFound) {
        target = solutionFound;
    } else if (projectFound) {
        target = projectFound;
    }
} else {
    if (projectFound) {
        target = projectFound;
    } else if (solutionFound) {
        target = solutionFound;
    }
}

if (!target) {
    console.error('Error: No project or solution discovered by get-project-and-solution-files-from-directory.');
    process.exit(1);
}

console.log(`path=${target}`);
process.exit(0);
