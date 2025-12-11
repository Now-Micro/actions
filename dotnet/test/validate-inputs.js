function normalize(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function validateInputs(env = {}) {
    const projectFile = normalize(env.PROJECT_FILE);
    if (projectFile) {
        return {
            status: 'project',
            message: 'project-file provided: validation passed',
        };
    }

    const directory = normalize(env.DIRECTORY);
    if (!directory) {
        return {
            status: 'error',
            message: "Error: Provide 'project-file' or 'directory' and an optional 'project-regex'.",
        };
    }

    return {
        status: 'directory',
        message: 'directory provided: validation passed',
    };
}

function main(env = process.env, options = {}) {
    const logger = options.logger ?? console;
    const exit = options.exit ?? process.exit;

    const result = validateInputs(env);
    if (result.status === 'error') {
        logger.error(result.message);
        exit(1);
        return;
    }

    logger.log(result.message);
}

module.exports = {
    validateInputs,
    main,
};
