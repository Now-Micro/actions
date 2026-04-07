const fs = require('fs');

function parseVersions(input) {
    if (!input) return [];
    return input.split(',').map(s => s.trim()).filter(Boolean);
}

function run() {
    const raw = process.env.INPUT_DOTNET_VERSION;
    if (!raw) {
        console.error('INPUT_DOTNET_VERSION is required');
        process.exit(1);
    }

    const versions = parseVersions(raw);
    if (versions.length === 0) {
        console.error('No versions parsed from INPUT_DOTNET_VERSION');
        process.exit(1);
    }

    if (versions.length > 5) {
        console.error(`Too many .NET versions provided (${versions.length}); maximum supported is 5.`);
        process.exit(1);
    }

    const ghOutput = process.env.GITHUB_OUTPUT;
    if (!ghOutput) {
        console.error('GITHUB_OUTPUT not set');
        process.exit(1);
    }

    const lines = [`version_count=${versions.length}`];
    versions.forEach((version, index) => {
        lines.push(`version_${index + 1}=${version}`);
        console.log(`Resolved .NET SDK ${index + 1}: ${version}`);
    });

    fs.appendFileSync(ghOutput, `${lines.join('\n')}\n`);
}

if (require.main === module) run();

module.exports = { run, parseVersions };
