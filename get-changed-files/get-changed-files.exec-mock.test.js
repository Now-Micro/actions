const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

function withStubbedExecSync(script) {
    const cp = require('child_process');
    const original = cp.execSync;
    delete require.cache[require.resolve('./get-changed-files')];
    let calls = [];
    cp.execSync = (cmd, opts = {}) => {
        const key = typeof cmd === 'string' ? cmd : String(cmd);
        calls.push(key);
        return script(key, opts);
    };
    const mod = require('./get-changed-files');
    const restore = () => {
        require('child_process').execSync = original;
        delete require.cache[require.resolve('./get-changed-files')];
    };
    return { mod, calls, restore };
}

test('extractSha falls back to explicit tag fetch and resolves via refs/tags/<tag>', () => {
    const TAG = 'v1.2.3';
    const sha = 'c0ffee1234567890c0ffee1234567890c0ffee12';
    const { mod, restore } = withStubbedExecSync((cmd) => {
        if (cmd.startsWith('git remote get-url origin')) return 'origin-url\n';
        if (cmd.startsWith('git rev-list -n 1 ')) {
            if (cmd.endsWith(`refs/tags/${TAG}`)) return sha + '\n';
            // other rev-list attempts fail
            const e = new Error('rev-list fail'); e.status = 1; throw e;
        }
        if (cmd === `git fetch origin ${TAG}`) { const e = new Error('fetch ref fail'); e.status = 1; throw e; }
        if (cmd === 'git fetch --tags --quiet origin') { const e = new Error('fetch tags fail'); e.status = 1; throw e; }
        if (cmd === `git fetch origin tag ${TAG}`) return '';
        // Any other command default fail
        const e = new Error('unexpected'); e.status = 1; throw e;
    });
    const resolved = mod.extractSha(TAG, '');
    try { assert.strictEqual(resolved, sha); } finally { restore(); }
});

test('extractSha ultimate fallback uses ls-remote to resolve tag SHA', () => {
    const TAG = 'release-2025-09-24';
    const sha = 'deadbeefcafebabe1234567890abcdef12345678';
    const { mod, restore } = withStubbedExecSync((cmd, opts) => {
        if (cmd.startsWith('git remote get-url origin')) return 'origin-url\n';
        if (cmd.startsWith('git rev-list -n 1 ')) { const e = new Error('rev-list fail'); e.status = 1; throw e; }
        if (cmd === `git fetch origin ${TAG}`) { const e = new Error('fetch ref fail'); e.status = 1; throw e; }
        if (cmd === 'git fetch --tags --quiet origin') { const e = new Error('fetch tags fail'); e.status = 1; throw e; }
        if (cmd === `git fetch origin tag ${TAG}`) { const e = new Error('fetch tag fail'); e.status = 1; throw e; }
        if (cmd.startsWith('git ls-remote --tags origin ')) {
            return `${sha}\trefs/tags/${TAG}^{}\n`;
        }
        const e = new Error('unexpected'); e.status = 1; throw e;
    });
    const resolved = mod.extractSha(TAG, '');
    try { assert.strictEqual(resolved, sha); } finally { restore(); }
});
