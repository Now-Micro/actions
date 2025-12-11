function parseBool(value) {
    if (typeof value === 'string') {
        return ['1', 'true', 'yes'].includes(value.toLowerCase().trim());
    }
    return Boolean(value);
}

function resolveTarget(env = {}) {
    const projectFile = env.PROJECT_FILE?.trim();
    if (projectFile) {
        return projectFile;
    }

    const preferSolution = parseBool(env.PREFER_SOLUTION);
    const projectFound = env.PROJECT_FOUND?.trim() || '';
    const solutionFound = env.SOLUTION_FOUND?.trim() || '';

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
        throw new Error('No project or solution discovered by get-project-and-solution-files-from-directory.');
    }

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

if (require.main === module) {
    main();
}

module.exports = {
    resolveTarget,
    main,
};
