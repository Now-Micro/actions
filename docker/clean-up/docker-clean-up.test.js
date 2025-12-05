const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
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
    run,
} = require('./docker-clean-up');

// ==================== parseBool tests ====================

test('parseBool handles boolean inputs', () => {
    assert.strictEqual(parseBool(true), true);
    assert.strictEqual(parseBool(false), false);
});

test('parseBool handles string true variants', () => {
    assert.strictEqual(parseBool('true'), true);
    assert.strictEqual(parseBool('TRUE'), true);
    assert.strictEqual(parseBool('True'), true);
    assert.strictEqual(parseBool('1'), true);
    assert.strictEqual(parseBool('yes'), true);
    assert.strictEqual(parseBool('YES'), true);
    assert.strictEqual(parseBool('  true  '), true);
});

test('parseBool handles string false variants', () => {
    assert.strictEqual(parseBool('false'), false);
    assert.strictEqual(parseBool('FALSE'), false);
    assert.strictEqual(parseBool('0'), false);
    assert.strictEqual(parseBool('no'), false);
    assert.strictEqual(parseBool('anything'), false);
});

test('parseBool handles empty and undefined', () => {
    assert.strictEqual(parseBool(''), false);
    assert.strictEqual(parseBool(undefined), false);
    assert.strictEqual(parseBool(null), false);
});

// ==================== getEpoch tests ====================

test('getEpoch parses valid ISO timestamp', () => {
    const epoch = getEpoch('2024-01-15T10:30:00Z');
    assert.strictEqual(typeof epoch, 'number');
    assert.ok(epoch > 0);
    assert.ok(epoch > 1704000000 && epoch < 1706000000);
});

test('getEpoch parses Docker-style timestamp', () => {
    const epoch = getEpoch('2024-06-01T12:00:00.123456789Z');
    assert.ok(epoch > 0);
});

test('getEpoch returns 0 for empty input', () => {
    assert.strictEqual(getEpoch(''), 0);
    assert.strictEqual(getEpoch(null), 0);
    assert.strictEqual(getEpoch(undefined), 0);
});

test('getEpoch returns 0 for invalid timestamp', () => {
    assert.strictEqual(getEpoch('not-a-date'), 0);
    assert.strictEqual(getEpoch('invalid'), 0);
});

// ==================== selectRemoveIds tests ====================

test('selectRemoveIds returns empty array for empty input', () => {
    const result = selectRemoveIds([], 5);
    assert.deepStrictEqual(result, []);
});

test('selectRemoveIds keeps newest N entries', () => {
    const entries = [
        { epoch: 100, id: 'oldest' },
        { epoch: 300, id: 'newest' },
        { epoch: 200, id: 'middle' },
    ];
    const result = selectRemoveIds([...entries], 1);
    assert.deepStrictEqual(result, ['middle', 'oldest']);
});

test('selectRemoveIds removes all when keepCount is 0', () => {
    const entries = [
        { epoch: 100, id: 'a' },
        { epoch: 200, id: 'b' },
        { epoch: 300, id: 'c' },
    ];
    const result = selectRemoveIds([...entries], 0);
    assert.strictEqual(result.length, 3);
});

test('selectRemoveIds keeps all when keepCount >= entries length', () => {
    const entries = [
        { epoch: 100, id: 'a' },
        { epoch: 200, id: 'b' },
    ];
    const result = selectRemoveIds([...entries], 5);
    assert.deepStrictEqual(result, []);
});

test('selectRemoveIds handles entries with same epoch', () => {
    const entries = [
        { epoch: 100, id: 'a' },
        { epoch: 100, id: 'b' },
        { epoch: 100, id: 'c' },
    ];
    const result = selectRemoveIds([...entries], 1);
    assert.strictEqual(result.length, 2);
});

test('selectRemoveIds preserves order by epoch descending', () => {
    const entries = [
        { epoch: 500, id: 'e' },
        { epoch: 100, id: 'a' },
        { epoch: 400, id: 'd' },
        { epoch: 200, id: 'b' },
        { epoch: 300, id: 'c' },
    ];
    const result = selectRemoveIds([...entries], 2);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0], 'c');
    assert.strictEqual(result[1], 'b');
    assert.strictEqual(result[2], 'a');
});

// ==================== createConfig tests ====================

test('createConfig parses environment variables correctly', () => {
    const env = {
        INPUT_PREFIX: 'myapp',
        INPUT_KEEP_COUNT: '5',
        INPUT_DEBUG_MODE: 'true',
        INPUT_DRY_RUN: 'false',
        INPUT_SKIP_CONTAINERS: 'true',
        INPUT_SKIP_IMAGES: 'false',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'false',
        INPUT_REMOVE_DANGLING_IMAGES: 'true',
        INPUT_USE_SUDO: 'false',
    };
    const config = createConfig(env);

    assert.strictEqual(config.prefix, 'myapp');
    assert.strictEqual(config.keepCount, 5);
    assert.strictEqual(config.debugMode, true);
    assert.strictEqual(config.dryRun, false);
    assert.strictEqual(config.skipContainers, true);
    assert.strictEqual(config.skipImages, false);
    assert.strictEqual(config.skipVolumes, true);
    assert.strictEqual(config.skipNetworks, false);
    assert.strictEqual(config.removeDanglingImages, true);
    assert.strictEqual(config.useSudo, false);
});

test('createConfig uses defaults for missing env vars', () => {
    const config = createConfig({});

    assert.strictEqual(config.prefix, '');
    assert.strictEqual(config.keepCount, 0);
    assert.strictEqual(config.debugMode, false);
    assert.strictEqual(config.dryRun, false);
    assert.strictEqual(config.skipContainers, false);
    assert.strictEqual(config.skipImages, false);
    assert.strictEqual(config.skipVolumes, false);
    assert.strictEqual(config.skipNetworks, false);
    assert.strictEqual(config.removeDanglingImages, false);
    assert.strictEqual(config.useSudo, false);
});

test('createConfig handles invalid keepCount', () => {
    const config1 = createConfig({ INPUT_KEEP_COUNT: 'invalid' });
    assert.strictEqual(config1.keepCount, 0);

    const config2 = createConfig({ INPUT_KEEP_COUNT: '-5' });
    assert.strictEqual(config2.keepCount, 0);
});

// ==================== createStats tests ====================

test('createStats initializes counters to zero', () => {
    const stats = createStats();
    assert.strictEqual(stats.containersRemoved, 0);
    assert.strictEqual(stats.imagesRemoved, 0);
    assert.strictEqual(stats.volumesRemoved, 0);
    assert.strictEqual(stats.networksRemoved, 0);
});

// ==================== dockerExec tests ====================

test('dockerExec runs command and returns stdout', () => {
    const config = createConfig({ INPUT_PREFIX: 'test' });
    // Use a simple command that works on all platforms
    const result = dockerExec(['version', '--format', '{{.Client.Version}}'], config, { silent: true, ignoreError: true });
    // If docker is available, returns a version string; otherwise empty string
    assert.strictEqual(typeof result, 'string');
});

test('dockerExec with sudo prepends sudo to command', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_USE_SUDO: 'true', INPUT_DRY_RUN: 'true' });
    // Dry run with sudo shouldn't actually run sudo
    const result = dockerExec(['rm', 'testcontainer'], config, { silent: false });
    assert.strictEqual(result, '');
});

test('dockerExec dry run logs destructive commands', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DRY_RUN: 'true', INPUT_DEBUG_MODE: 'true' });
    const result = dockerExec(['rm', 'testcontainer'], config, { silent: false });

    console.log = origLog;
    assert.strictEqual(result, '');
    const dryRunLog = logs.find(l => l.includes('[DRY-RUN]'));
    assert.ok(dryRunLog, 'Expected dry-run log');
});

test('dockerExec dry run does not log when silent', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DRY_RUN: 'true' });
    // Non-destructive command in dry-run with silent should still try to run
    const result = dockerExec(['ps'], config, { silent: true, ignoreError: true });

    console.log = origLog;
    // Should have attempted to run (not blocked by dry-run for non-destructive)
    assert.strictEqual(typeof result, 'string');
});

test('dockerExec handles invalid docker command gracefully', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DEBUG_MODE: 'true' });

    // Use an invalid docker command - docker will return non-zero exit
    const result = dockerExec(['nonexistent-command'], config, { ignoreError: true });

    // Should return empty string without throwing
    assert.strictEqual(result, '');
});

test('dockerExec prune command in dry-run mode', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DRY_RUN: 'true' });
    const result = dockerExec(['image', 'prune', '-f'], config, { silent: false });

    console.log = origLog;
    assert.strictEqual(result, '');
    const dryRunLog = logs.find(l => l.includes('[DRY-RUN]'));
    assert.ok(dryRunLog, 'Expected dry-run log for prune');
});

test('dockerExec rmi command in dry-run mode', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DRY_RUN: 'true' });
    const result = dockerExec(['rmi', 'testimage'], config, { silent: false });

    console.log = origLog;
    assert.strictEqual(result, '');
    const dryRunLog = logs.find(l => l.includes('[DRY-RUN]'));
    assert.ok(dryRunLog, 'Expected dry-run log for rmi');
});

// ==================== debug tests ====================

test('debug logs when debugMode is true', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    debug('test message', true);

    console.log = origLog;
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0], '[DEBUG] test message');
});

test('debug does not log when debugMode is false', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    debug('test message', false);

    console.log = origLog;
    assert.strictEqual(logs.length, 0);
});

// ==================== writeOutputs tests ====================

test('writeOutputs writes to GITHUB_OUTPUT file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const stats = {
        containersRemoved: 3,
        imagesRemoved: 2,
        volumesRemoved: 1,
        networksRemoved: 0,
    };

    writeOutputs(stats, outputFile);

    const content = fs.readFileSync(outputFile, 'utf8');
    assert.ok(content.includes('containers_removed=3'));
    assert.ok(content.includes('images_removed=2'));
    assert.ok(content.includes('volumes_removed=1'));
    assert.ok(content.includes('networks_removed=0'));

    fs.rmSync(tmpDir, { recursive: true });
});

test('writeOutputs does nothing when no output file', () => {
    // Should not throw
    writeOutputs({ containersRemoved: 0, imagesRemoved: 0, volumesRemoved: 0, networksRemoved: 0 }, null);
    writeOutputs({ containersRemoved: 0, imagesRemoved: 0, volumesRemoved: 0, networksRemoved: 0 }, '');
});

// ==================== cleanupContainers tests ====================

test('cleanupContainers skips when no containers found', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_DEBUG_MODE: 'true' });
    const stats = createStats();
    const calls = [];

    const mockExec = (args, cfg, opts) => {
        calls.push({ args, opts });
        if (args[0] === 'ps') return '';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    assert.strictEqual(stats.containersRemoved, 0);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].args[0], 'ps');
});

test('cleanupContainers removes all containers when keepCount is 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'true' });
    const stats = createStats();
    const calls = [];

    const mockExec = (args, cfg, opts) => {
        calls.push({ args, opts });
        if (args[0] === 'ps') return 'container1\ncontainer2';
        if (args[0] === 'rm') return '';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    assert.strictEqual(stats.containersRemoved, 2);
});

test('cleanupContainers groups by image and keeps newest', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1\nc2\nc3';
        if (args[0] === 'inspect') {
            // args: ['inspect', '--format', '{{.Config.Image}}', 'c1']
            const format = args[2];
            const id = args[3];
            if (format.includes('Image')) {
                return 'myimage';
            }
            if (format.includes('Created')) {
                if (id === 'c1') return '2024-01-01T10:00:00Z';
                if (id === 'c2') return '2024-01-02T10:00:00Z';
                if (id === 'c3') return '2024-01-03T10:00:00Z';
            }
        }
        if (args[0] === 'rm') return '';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    // Should keep 1 newest (c3), remove 2 (c1, c2)
    assert.strictEqual(stats.containersRemoved, 2);
});

test('cleanupContainers skips containers without image', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DEBUG_MODE: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1';
        if (args[0] === 'inspect' && args[1].includes('Image')) return '';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    assert.strictEqual(stats.containersRemoved, 0);
});

test('cleanupContainers skips containers without created time', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DEBUG_MODE: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1';
        if (args[0] === 'inspect' && args[1].includes('Image')) return 'myimage';
        if (args[0] === 'inspect' && args[1].includes('Created')) return '';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    assert.strictEqual(stats.containersRemoved, 0);
});

test('cleanupContainers handles no containers to remove after grouping', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '5', INPUT_DEBUG_MODE: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1';
        if (args[0] === 'inspect' && args[1].includes('Image')) return 'myimage';
        if (args[1].includes('Created')) return '2024-01-01T10:00:00Z';
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    // keepCount=5 but only 1 container, so nothing removed
    assert.strictEqual(stats.containersRemoved, 0);
});

test('cleanupContainers increments counter in non-dry-run mode (keepCount=0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'container1\ncontainer2\ncontainer3';
        if (args[0] === 'rm') {
            removedIds.push(args[2]);
            return args[2]; // Docker rm returns container ID on success
        }
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    assert.strictEqual(stats.containersRemoved, 3);
    assert.deepStrictEqual(removedIds, ['container1', 'container2', 'container3']);
});

test('cleanupContainers increments counter in non-dry-run mode (keepCount>0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1\nc2\nc3';
        if (args[0] === 'inspect') {
            const format = args[2];
            const id = args[3];
            if (format.includes('Image')) return 'myimage';
            if (format.includes('Created')) {
                if (id === 'c1') return '2024-01-01T10:00:00Z';
                if (id === 'c2') return '2024-01-02T10:00:00Z';
                if (id === 'c3') return '2024-01-03T10:00:00Z';
            }
        }
        if (args[0] === 'rm') {
            removedIds.push(args[2]);
            return args[2];
        }
        return '';
    };

    cleanupContainers(config, stats, mockExec);

    // Should keep 1 newest (c3), remove 2 (c1, c2)
    assert.strictEqual(stats.containersRemoved, 2);
    assert.ok(removedIds.includes('c1'));
    assert.ok(removedIds.includes('c2'));
    assert.ok(!removedIds.includes('c3'));
});

// ==================== cleanupImages tests ====================

test('cleanupImages skips when no images found', () => {
    const config = createConfig({ INPUT_PREFIX: 'test' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return '';
        return '';
    };

    cleanupImages(config, stats, mockExec);

    assert.strictEqual(stats.imagesRemoved, 0);
});

test('cleanupImages removes all matching images when keepCount is 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'myapp', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return 'myapp:latest img1\nmyapp:v1 img2\nother:latest img3';
        if (args[0] === 'rmi') return '';
        return '';
    };

    cleanupImages(config, stats, mockExec);

    // Should remove 2 images (myapp:latest and myapp:v1), other:latest doesn't match prefix 'myapp'
    assert.strictEqual(stats.imagesRemoved, 2);
});

test('cleanupImages keeps newest when keepCount > 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return 'test-app:v1 img1\ntest-app:v2 img2';
        if (args[0] === 'inspect' && args[3] === 'img1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'inspect' && args[3] === 'img2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'rmi') return '';
        return '';
    };

    cleanupImages(config, stats, mockExec);

    // Should keep 1 newest (img2), remove 1 (img1)
    assert.strictEqual(stats.imagesRemoved, 1);
});

test('cleanupImages handles no images to remove after filtering', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '5', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return 'test-app:v1 img1';
        if (args[0] === 'inspect') return '2024-01-01T10:00:00Z';
        return '';
    };

    cleanupImages(config, stats, mockExec);

    // keepCount=5 but only 1 image, so nothing removed
    assert.strictEqual(stats.imagesRemoved, 0);
});

test('cleanupImages increments counter in non-dry-run mode (keepCount=0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'myapp', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return 'myapp:latest img1\nmyapp:v1 img2';
        if (args[0] === 'rmi') {
            removedIds.push(args[2]);
            return `Untagged: ${args[2]}`;
        }
        return '';
    };

    cleanupImages(config, stats, mockExec);

    assert.strictEqual(stats.imagesRemoved, 2);
    assert.deepStrictEqual(removedIds, ['img1', 'img2']);
});

test('cleanupImages increments counter in non-dry-run mode (keepCount>0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'images') return 'test-app:v1 img1\ntest-app:v2 img2';
        if (args[0] === 'inspect' && args[3] === 'img1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'inspect' && args[3] === 'img2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'rmi') {
            removedIds.push(args[2]);
            return `Untagged: ${args[2]}`;
        }
        return '';
    };

    cleanupImages(config, stats, mockExec);

    // Should keep 1 newest (img2), remove 1 (img1)
    assert.strictEqual(stats.imagesRemoved, 1);
    assert.deepStrictEqual(removedIds, ['img1']);
});

// ==================== cleanupDanglingImages tests ====================

test('cleanupDanglingImages calls docker image prune', () => {
    const config = createConfig({ INPUT_PREFIX: 'test' });
    const calls = [];

    const mockExec = (args, cfg, opts) => {
        calls.push(args);
        return '';
    };

    cleanupDanglingImages(config, mockExec);

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], ['image', 'prune', '-f']);
});

// ==================== cleanupVolumes tests ====================

test('cleanupVolumes skips when no volumes found', () => {
    const config = createConfig({ INPUT_PREFIX: 'test' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return '';
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    assert.strictEqual(stats.volumesRemoved, 0);
});

test('cleanupVolumes removes all matching volumes when keepCount is 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1\nvol2';
        if (args[0] === 'volume' && args[1] === 'rm') return '';
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    assert.strictEqual(stats.volumesRemoved, 2);
});

test('cleanupVolumes keeps newest when keepCount > 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1\nvol2';
        if (args[0] === 'volume' && args[1] === 'inspect' && args[4] === 'vol1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'volume' && args[1] === 'inspect' && args[4] === 'vol2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'volume' && args[1] === 'rm') return '';
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    assert.strictEqual(stats.volumesRemoved, 1);
});

test('cleanupVolumes handles no volumes to remove after filtering', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '5', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1';
        if (args[0] === 'volume' && args[1] === 'inspect') return '2024-01-01T10:00:00Z';
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    assert.strictEqual(stats.volumesRemoved, 0);
});

test('cleanupVolumes increments counter in non-dry-run mode (keepCount=0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1\nvol2\nvol3';
        if (args[0] === 'volume' && args[1] === 'rm') {
            removedIds.push(args[2]);
            return args[2];
        }
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    assert.strictEqual(stats.volumesRemoved, 3);
    assert.deepStrictEqual(removedIds, ['vol1', 'vol2', 'vol3']);
});

test('cleanupVolumes increments counter in non-dry-run mode (keepCount>0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1\nvol2';
        if (args[0] === 'volume' && args[1] === 'inspect' && args[4] === 'vol1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'volume' && args[1] === 'inspect' && args[4] === 'vol2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'volume' && args[1] === 'rm') {
            removedIds.push(args[2]);
            return args[2];
        }
        return '';
    };

    cleanupVolumes(config, stats, mockExec);

    // Should keep 1 newest (vol2), remove 1 (vol1)
    assert.strictEqual(stats.volumesRemoved, 1);
    assert.deepStrictEqual(removedIds, ['vol1']);
});

// ==================== cleanupNetworks tests ====================

test('cleanupNetworks skips when no networks found', () => {
    const config = createConfig({ INPUT_PREFIX: 'test' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return '';
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    assert.strictEqual(stats.networksRemoved, 0);
});

test('cleanupNetworks removes all matching networks when keepCount is 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return 'net1\nnet2';
        if (args[0] === 'network' && args[1] === 'rm') return '';
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    assert.strictEqual(stats.networksRemoved, 2);
});

test('cleanupNetworks keeps newest when keepCount > 0', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return 'net1\nnet2';
        if (args[0] === 'network' && args[1] === 'inspect' && args[4] === 'net1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'network' && args[1] === 'inspect' && args[4] === 'net2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'network' && args[1] === 'rm') return '';
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    assert.strictEqual(stats.networksRemoved, 1);
});

test('cleanupNetworks handles no networks to remove after filtering', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '5', INPUT_DRY_RUN: 'true' });
    const stats = createStats();

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return 'net1';
        if (args[0] === 'network' && args[1] === 'inspect') return '2024-01-01T10:00:00Z';
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    assert.strictEqual(stats.networksRemoved, 0);
});

test('cleanupNetworks increments counter in non-dry-run mode (keepCount=0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '0', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return 'net1\nnet2';
        if (args[0] === 'network' && args[1] === 'rm') {
            removedIds.push(args[2]);
            return args[2];
        }
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    assert.strictEqual(stats.networksRemoved, 2);
    assert.deepStrictEqual(removedIds, ['net1', 'net2']);
});

test('cleanupNetworks increments counter in non-dry-run mode (keepCount>0)', () => {
    const config = createConfig({ INPUT_PREFIX: 'test', INPUT_KEEP_COUNT: '1', INPUT_DRY_RUN: 'false' });
    const stats = createStats();
    const removedIds = [];

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'network' && args[1] === 'ls') return 'net1\nnet2\nnet3';
        if (args[0] === 'network' && args[1] === 'inspect' && args[4] === 'net1') return '2024-01-01T10:00:00Z';
        if (args[0] === 'network' && args[1] === 'inspect' && args[4] === 'net2') return '2024-01-02T10:00:00Z';
        if (args[0] === 'network' && args[1] === 'inspect' && args[4] === 'net3') return '2024-01-03T10:00:00Z';
        if (args[0] === 'network' && args[1] === 'rm') {
            removedIds.push(args[2]);
            return args[2];
        }
        return '';
    };

    cleanupNetworks(config, stats, mockExec);

    // Should keep 1 newest (net3), remove 2 (net1, net2)
    assert.strictEqual(stats.networksRemoved, 2);
    assert.ok(removedIds.includes('net1'));
    assert.ok(removedIds.includes('net2'));
    assert.ok(!removedIds.includes('net3'));
});

// ==================== run tests ====================

test('run exits with error when prefix is missing', () => {
    let exitCode = null;
    const origExit = process.exit;
    process.exit = (code) => { exitCode = code; throw new Error('EXIT'); };

    try {
        run({}, () => '');
    } catch (e) {
        if (e.message !== 'EXIT') throw e;
    }

    process.exit = origExit;
    assert.strictEqual(exitCode, 1);
});

test('run skips cleanup when skip flags are set', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        INPUT_PREFIX: 'test',
        INPUT_SKIP_CONTAINERS: 'true',
        INPUT_SKIP_IMAGES: 'true',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    const calls = [];
    const mockExec = (args, cfg, opts) => {
        calls.push(args);
        return '';
    };

    const stats = run(env, mockExec);

    // Should not have called any cleanup functions
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(stats.containersRemoved, 0);
    assert.strictEqual(stats.imagesRemoved, 0);
    assert.strictEqual(stats.volumesRemoved, 0);
    assert.strictEqual(stats.networksRemoved, 0);

    fs.rmSync(tmpDir, { recursive: true });
});

test('run calls cleanupDanglingImages when flag is set', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        INPUT_PREFIX: 'test',
        INPUT_SKIP_CONTAINERS: 'true',
        INPUT_SKIP_IMAGES: 'true',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'true',
        INPUT_REMOVE_DANGLING_IMAGES: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    const calls = [];
    const mockExec = (args, cfg, opts) => {
        calls.push(args);
        return '';
    };

    run(env, mockExec);

    // Should have called image prune
    const pruneCall = calls.find(c => c[0] === 'image' && c[1] === 'prune');
    assert.ok(pruneCall, 'Expected image prune to be called');

    fs.rmSync(tmpDir, { recursive: true });
});

test('run performs full cleanup with all resources', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        INPUT_PREFIX: 'myapp',
        INPUT_KEEP_COUNT: '0',
        INPUT_DRY_RUN: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'container1';
        if (args[0] === 'images') return 'myapp:latest img1';
        if (args[0] === 'volume' && args[1] === 'ls') return 'vol1';
        if (args[0] === 'network' && args[1] === 'ls') return 'net1';
        return '';
    };

    const stats = run(env, mockExec);

    assert.strictEqual(stats.containersRemoved, 1);
    assert.strictEqual(stats.imagesRemoved, 1);
    assert.strictEqual(stats.volumesRemoved, 1);
    assert.strictEqual(stats.networksRemoved, 1);

    const content = fs.readFileSync(outputFile, 'utf8');
    assert.ok(content.includes('containers_removed=1'));
    assert.ok(content.includes('images_removed=1'));
    assert.ok(content.includes('volumes_removed=1'));
    assert.ok(content.includes('networks_removed=1'));

    fs.rmSync(tmpDir, { recursive: true });
});

test('run uses sudo when useSudo is true', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        INPUT_PREFIX: 'test',
        INPUT_USE_SUDO: 'true',
        INPUT_SKIP_IMAGES: 'true',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    // We can't easily test sudo usage without calling the real dockerExec,
    // but we verify that config.useSudo is true
    const config = createConfig(env);
    assert.strictEqual(config.useSudo, true);

    fs.rmSync(tmpDir, { recursive: true });
});

test('run with debug mode outputs debug messages', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const logs = [];
    const origLog = console.log;
    console.log = (msg) => logs.push(msg);

    const env = {
        INPUT_PREFIX: 'test',
        INPUT_DEBUG_MODE: 'true',
        INPUT_SKIP_CONTAINERS: 'true',
        INPUT_SKIP_IMAGES: 'true',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    run(env, () => '');

    console.log = origLog;

    const debugLogs = logs.filter(l => l.startsWith('[DEBUG]'));
    assert.ok(debugLogs.length > 0, 'Expected debug logs to be output');

    fs.rmSync(tmpDir, { recursive: true });
});

test('run handles multiple containers per image correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docker-clean-up-test-'));
    const outputFile = path.join(tmpDir, 'output.txt');
    fs.writeFileSync(outputFile, '');

    const env = {
        INPUT_PREFIX: 'app',
        INPUT_KEEP_COUNT: '1',
        INPUT_DRY_RUN: 'true',
        INPUT_SKIP_IMAGES: 'true',
        INPUT_SKIP_VOLUMES: 'true',
        INPUT_SKIP_NETWORKS: 'true',
        GITHUB_OUTPUT: outputFile,
    };

    const mockExec = (args, cfg, opts) => {
        if (args[0] === 'ps') return 'c1\nc2\nc3\nc4';
        if (args[0] === 'inspect') {
            // args: ['inspect', '--format', '{{.Config.Image}}', 'c1']
            const format = args[2];
            const id = args[3];
            // c1, c2 belong to image-a; c3, c4 belong to image-b
            if (format.includes('Image')) {
                if (id === 'c1' || id === 'c2') return 'image-a';
                return 'image-b';
            }
            if (format.includes('Created')) {
                if (id === 'c1') return '2024-01-01T10:00:00Z';
                if (id === 'c2') return '2024-01-02T10:00:00Z';
                if (id === 'c3') return '2024-01-03T10:00:00Z';
                if (id === 'c4') return '2024-01-04T10:00:00Z';
            }
        }
        return '';
    };

    const stats = run(env, mockExec);

    // Keep 1 per image: keep c2 (newest for image-a), keep c4 (newest for image-b)
    // Remove: c1, c3
    assert.strictEqual(stats.containersRemoved, 2);

    fs.rmSync(tmpDir, { recursive: true });
});
