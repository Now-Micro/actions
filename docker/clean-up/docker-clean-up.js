#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');

// Parse boolean from string/boolean input
function parseBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.toLowerCase().trim();
        return lower === 'true' || lower === '1' || lower === 'yes';
    }
    return false;
}

// Parse ISO timestamp to epoch seconds
function getEpoch(createdRaw) {
    if (!createdRaw) return 0;
    try {
        const date = new Date(createdRaw);
        if (isNaN(date.getTime())) return 0;
        return Math.floor(date.getTime() / 1000);
    } catch {
        return 0;
    }
}

// Sort entries by epoch descending and return IDs to remove (keeping N newest)
function selectRemoveIds(entries, keepCount) {
    if (entries.length === 0) return [];

    // Sort by epoch descending (newest first)
    entries.sort((a, b) => b.epoch - a.epoch);

    // Return IDs after the first keepCount entries
    return entries.slice(keepCount).map(e => e.id);
}

// Create configuration from environment variables
function createConfig(env = process.env) {
    let keepCount = parseInt(env.INPUT_KEEP_COUNT || '0', 10);
    if (!Number.isFinite(keepCount) || keepCount < 0) {
        keepCount = 0;
    }

    return {
        prefix: env.INPUT_PREFIX || '',
        keepCount,
        debugMode: parseBool(env.INPUT_DEBUG_MODE),
        dryRun: parseBool(env.INPUT_DRY_RUN),
        skipContainers: parseBool(env.INPUT_SKIP_CONTAINERS),
        skipImages: parseBool(env.INPUT_SKIP_IMAGES),
        skipVolumes: parseBool(env.INPUT_SKIP_VOLUMES),
        skipNetworks: parseBool(env.INPUT_SKIP_NETWORKS),
        removeDanglingImages: parseBool(env.INPUT_REMOVE_DANGLING_IMAGES),
        useSudo: parseBool(env.INPUT_USE_SUDO),
    };
}

// Create stats object for tracking removed resources
function createStats() {
    return {
        containersRemoved: 0,
        imagesRemoved: 0,
        volumesRemoved: 0,
        networksRemoved: 0,
    };
}

// Logging helpers
function log(msg) {
    console.log(msg);
}

function debug(msg, debugMode) {
    if (debugMode) {
        console.log(`[DEBUG] ${msg}`);
    }
}

// Execute a docker command and return stdout (or empty string on failure)
function dockerExec(args, config, options = {}) {
    const { silent = false, ignoreError = false } = options;
    const cmd = config.useSudo ? ['sudo', 'docker', ...args] : ['docker', ...args];
    const cmdStr = cmd.join(' ');

    debug(`Running: ${cmdStr}`, config.debugMode);

    if (config.dryRun && !silent) {
        // If it's a destructive command, just log it
        if (args.includes('rm') || args.includes('rmi') || args.includes('prune')) {
            log(`[DRY-RUN] ${cmdStr}`);
            return '';
        }
    }

    try {
        const result = spawnSync(cmd[0], cmd.slice(1), {
            encoding: 'utf8',
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
        });

        if (result.error) {
            if (!ignoreError) {
                debug(`Command error: ${result.error.message}`, config.debugMode);
            }
            return '';
        }

        if (result.status !== 0 && !ignoreError) {
            debug(`Command failed with exit code ${result.status}: ${result.stderr}`, config.debugMode);
            return '';
        }

        return (result.stdout || '').trim();
    } catch (err) {
        if (!ignoreError) {
            debug(`Exception running command: ${err.message}`, config.debugMode);
        }
        return '';
    }
}

// Cleanup containers
function cleanupContainers(config, stats, execFn = dockerExec) {
    debug('Starting containers cleanup', config.debugMode);

    const output = execFn(['ps', '-a', '--filter', `name=${config.prefix}`, '--format', '{{.ID}}'], config, { silent: true });
    const ids = output ? output.split('\n').filter(Boolean) : [];

    debug(`Found ${ids.length} container(s) matching prefix '${config.prefix}'`, config.debugMode);

    if (ids.length === 0) {
        debug('No containers matched prefix; skipping containers cleanup', config.debugMode);
        return;
    }

    if (config.keepCount === 0) {
        log(`Removing ALL ${ids.length} matching container(s)...`);
        for (const id of ids) {
            log(`Removing container ${id}...`);
            const result = execFn(['rm', '-f', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.containersRemoved++;
            }
        }
        debug('Completed container removals (KEEP_COUNT=0)', config.debugMode);
        return;
    }

    // Group containers by image and track creation time
    const imageContainers = new Map();

    for (const id of ids) {
        debug(`Inspecting container ${id}`, config.debugMode);

        const imageName = execFn(['inspect', '--format', '{{.Config.Image}}', id], config, { silent: true, ignoreError: true });
        if (!imageName) {
            debug(`Skipping container ${id} (no image)`, config.debugMode);
            continue;
        }

        const createdRaw = execFn(['inspect', '--format', '{{.Created}}', id], config, { silent: true, ignoreError: true });
        if (!createdRaw) {
            debug(`Skipping container ${id} (no created time)`, config.debugMode);
            continue;
        }

        const epoch = getEpoch(createdRaw);

        if (!imageContainers.has(imageName)) {
            imageContainers.set(imageName, []);
        }
        imageContainers.get(imageName).push({ epoch, id });
    }

    // For each image, determine which containers to remove
    const removeIds = [];

    for (const [, containers] of imageContainers) {
        const toRemove = selectRemoveIds([...containers], config.keepCount);
        removeIds.push(...toRemove);
    }

    debug(`Containers to remove: ${removeIds.length}`, config.debugMode);

    if (removeIds.length > 0) {
        for (const id of removeIds) {
            log(`Removing container ${id}...`);
            const result = execFn(['rm', '-f', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.containersRemoved++;
            }
        }
    } else {
        debug('No containers to remove', config.debugMode);
    }
}

// Cleanup images
function cleanupImages(config, stats, execFn = dockerExec) {
    debug('Starting images cleanup', config.debugMode);

    const output = execFn(['images', '--format', '{{.Repository}}:{{.Tag}} {{.ID}}'], config, { silent: true });
    const lines = output ? output.split('\n').filter(Boolean) : [];

    // Filter images matching prefix
    const imgIds = [];
    for (const line of lines) {
        const parts = line.split(' ');
        const repoTag = parts[0];
        const id = parts[1];
        if (repoTag && repoTag.includes(config.prefix)) {
            imgIds.push(id);
        }
    }

    debug(`Found ${imgIds.length} image(s) matching prefix '${config.prefix}'`, config.debugMode);

    if (imgIds.length === 0) {
        debug('No images matched prefix; skipping images cleanup', config.debugMode);
        return;
    }

    if (config.keepCount === 0) {
        log(`Removing ALL ${imgIds.length} matching image(s)...`);
        for (const id of imgIds) {
            log(`Removing image ${id}...`);
            const result = execFn(['rmi', '-f', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.imagesRemoved++;
            }
        }
        return;
    }

    // Collect image entries with creation times
    const imgEntries = [];
    for (const id of imgIds) {
        const createdRaw = execFn(['inspect', '--format', '{{.Created}}', id], config, { silent: true, ignoreError: true });
        const epoch = getEpoch(createdRaw);
        imgEntries.push({ epoch, id });
    }

    const removeIds = selectRemoveIds(imgEntries, config.keepCount);

    if (removeIds.length > 0) {
        for (const id of removeIds) {
            log(`Removing image ${id}...`);
            const result = execFn(['rmi', '-f', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.imagesRemoved++;
            }
        }
    }
}

// Cleanup dangling images
function cleanupDanglingImages(config, execFn = dockerExec) {
    debug('Starting dangling images cleanup', config.debugMode);
    execFn(['image', 'prune', '-f'], config);
}

// Cleanup volumes
function cleanupVolumes(config, stats, execFn = dockerExec) {
    debug('Starting volumes cleanup', config.debugMode);

    const output = execFn(['volume', 'ls', '--filter', `name=${config.prefix}`, '--format', '{{.Name}}'], config, { silent: true });
    const ids = output ? output.split('\n').filter(Boolean) : [];

    debug(`Found ${ids.length} volume(s) matching prefix '${config.prefix}'`, config.debugMode);

    if (ids.length === 0) {
        debug('No volumes matched prefix; skipping volumes cleanup', config.debugMode);
        return;
    }

    if (config.keepCount === 0) {
        log(`Removing ALL ${ids.length} matching volume(s)...`);
        for (const id of ids) {
            log(`Removing volume ${id}...`);
            const result = execFn(['volume', 'rm', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.volumesRemoved++;
            }
        }
        return;
    }

    // Collect volume entries with creation times
    const volEntries = [];
    for (const id of ids) {
        const createdRaw = execFn(['volume', 'inspect', '--format', '{{.CreatedAt}}', id], config, { silent: true, ignoreError: true });
        const epoch = getEpoch(createdRaw);
        volEntries.push({ epoch, id });
    }

    const removeIds = selectRemoveIds(volEntries, config.keepCount);

    if (removeIds.length > 0) {
        for (const id of removeIds) {
            log(`Removing volume ${id}...`);
            const result = execFn(['volume', 'rm', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.volumesRemoved++;
            }
        }
    }
}

// Cleanup networks
function cleanupNetworks(config, stats, execFn = dockerExec) {
    debug('Starting networks cleanup', config.debugMode);

    const output = execFn(['network', 'ls', '--filter', `name=${config.prefix}`, '--format', '{{.ID}}'], config, { silent: true });
    const ids = output ? output.split('\n').filter(Boolean) : [];

    debug(`Found ${ids.length} network(s) matching prefix '${config.prefix}'`, config.debugMode);

    if (ids.length === 0) {
        debug('No networks matched prefix; skipping networks cleanup', config.debugMode);
        return;
    }

    if (config.keepCount === 0) {
        log(`Removing ALL ${ids.length} matching network(s)...`);
        for (const id of ids) {
            log(`Removing network ${id}...`);
            const result = execFn(['network', 'rm', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.networksRemoved++;
            }
        }
        return;
    }

    // Collect network entries with creation times
    const netEntries = [];
    for (const id of ids) {
        const createdRaw = execFn(['network', 'inspect', '--format', '{{.Created}}', id], config, { silent: true, ignoreError: true });
        const epoch = getEpoch(createdRaw);
        netEntries.push({ epoch, id });
    }

    const removeIds = selectRemoveIds(netEntries, config.keepCount);

    if (removeIds.length > 0) {
        for (const id of removeIds) {
            log(`Removing network ${id}...`);
            const result = execFn(['network', 'rm', id], config, { ignoreError: true });
            if (result !== '' || config.dryRun) {
                stats.networksRemoved++;
            }
        }
    }
}

// Write outputs to GITHUB_OUTPUT
function writeOutputs(stats, githubOutput) {
    if (githubOutput) {
        const outputs = [
            `containers_removed=${stats.containersRemoved}`,
            `images_removed=${stats.imagesRemoved}`,
            `volumes_removed=${stats.volumesRemoved}`,
            `networks_removed=${stats.networksRemoved}`,
        ];
        fs.appendFileSync(githubOutput, outputs.join('\n') + '\n');
    }
}

// Main execution
function run(env = process.env, execFn = dockerExec) {
    const config = createConfig(env);
    const stats = createStats();

    // Validate required inputs
    if (!config.prefix) {
        console.error('❌ INPUT_PREFIX is required');
        process.exit(1);
    }

    debug(`Running cleanup with: PREFIX='${config.prefix}', KEEP_COUNT=${config.keepCount}, DEBUG=${config.debugMode}, DRY_RUN=${config.dryRun}, SKIP_CONTAINERS=${config.skipContainers}, SKIP_IMAGES=${config.skipImages}, SKIP_VOLUMES=${config.skipVolumes}, SKIP_NETWORKS=${config.skipNetworks}, REMOVE_DANGLING=${config.removeDanglingImages}, USE_SUDO=${config.useSudo}`, config.debugMode);

    // Run cleanup steps
    if (!config.skipContainers) {
        cleanupContainers(config, stats, execFn);
    } else {
        debug('Skipping containers cleanup by flag', config.debugMode);
    }

    if (!config.skipImages) {
        cleanupImages(config, stats, execFn);
    } else {
        debug('Skipping images cleanup by flag', config.debugMode);
    }

    if (config.removeDanglingImages) {
        cleanupDanglingImages(config, execFn);
    } else {
        debug('Skipping dangling images cleanup by flag', config.debugMode);
    }

    if (!config.skipVolumes) {
        cleanupVolumes(config, stats, execFn);
    } else {
        debug('Skipping volumes cleanup by flag', config.debugMode);
    }

    if (!config.skipNetworks) {
        cleanupNetworks(config, stats, execFn);
    } else {
        debug('Skipping networks cleanup by flag', config.debugMode);
    }

    // Write outputs
    writeOutputs(stats, env.GITHUB_OUTPUT);

    // Summary
    log('');
    log('=== Cleanup Summary ===');
    log(`Containers removed: ${stats.containersRemoved}`);
    log(`Images removed: ${stats.imagesRemoved}`);
    log(`Volumes removed: ${stats.volumesRemoved}`);
    log(`Networks removed: ${stats.networksRemoved}`);
    log('');
    log('Cleanup complete.');

    return stats;
}

if (require.main === module) {
    run();
}

module.exports = {
    run,
    parseBool,
    getEpoch,
    selectRemoveIds,
    createConfig,
    createStats,
    cleanupContainers,
    cleanupImages,
    cleanupDanglingImages,
    cleanupVolumes,
    cleanupNetworks,
    writeOutputs,
    dockerExec,
    debug,
    log,
};
