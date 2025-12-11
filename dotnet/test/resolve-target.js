function parseBool(value) {
    if (typeof value === 'string') {
        return ['1', 'true', 'yes'].includes(value.toLowerCase().trim());
    }
    return Boolean(value);
}

function debugLog(debugMode, message) {
    if (debugMode) {
        console.log(`🔍 ${message}`);
    }
}

function resolveTarget(env = {}) {
    const debugMode = parseBool(env.DEBUG_MODE);
    const projectFile = env.PROJECT_FILE?.trim();
    const preferSolution = parseBool(env.PREFER_SOLUTION);
    const projectFound = env.PROJECT_FOUND?.trim() || '';
    const solutionFound = env.SOLUTION_FOUND?.trim() || '';

    debugLog(debugMode, `Inputs: PROJECT_FILE='${projectFile}', PREFER_SOLUTION=${preferSolution}, PROJECT_FOUND='${projectFound}', SOLUTION_FOUND='${solutionFound}'`);

    if (projectFile) {
        debugLog(debugMode, `Using project-file input: ${projectFile}`);
        return projectFile;
    }

    let target = '';
    if (preferSolution) {
        debugLog(debugMode, 'Preference: solution over project');
        if (solutionFound) {
            debugLog(debugMode, `Solution available, selecting: ${solutionFound}`);
            target = solutionFound;
        } else if (projectFound) {
            debugLog(debugMode, `No solution found, falling back to project: ${projectFound}`);
            target = projectFound;
        }
    } else {
        debugLog(debugMode, 'Preference: project over solution');
        if (projectFound) {
            debugLog(debugMode, `Project available, selecting: ${projectFound}`);
            target = projectFound;
        } else if (solutionFound) {
            debugLog(debugMode, `No project found, falling back to solution: ${solutionFound}`);
            target = solutionFound;
        }
    }

    if (!target) {
        debugLog(debugMode, 'No project or solution available, raising error');
        throw new Error('No project or solution discovered by get-project-and-solution-files-from-directory.');
    }

    debugLog(debugMode, `Final target selected: ${target}`);
    return target;
}

function main(env = process.env) {
    try {
        const target = resolveTarget(env);
        console.log(`path=${target}`);
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

// When `node --test` loads files, it sets NODE_TEST_CONTEXT instead of running CLI logic.
if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
    main();
}

module.exports = {
    resolveTarget,
    main,
};
