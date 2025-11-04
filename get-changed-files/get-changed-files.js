const { execSync } = require('child_process');
const fs = require('fs');

function hasRemoteOrigin() {
    try {
        execSync('git remote get-url origin', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function ensureCommitExists(sha, prNumber) {
    if (!sha) {
        return false;
    }
    // First, attempt to verify the object directly (no ^{commit} to avoid Windows cmd escaping issues)
    try {
        execSync(`git cat-file -e ${sha}`, { stdio: 'ignore' });
        return true;
    } catch {
        // continue to fetch attempts
    }

    // If there's no remote origin, we cannot fetch – treat as missing
    if (!hasRemoteOrigin()) {
        return false;
    }

    // Try to fetch the PR ref if prNumber is provided
    if (prNumber) {
        try {
            execSync(`git fetch origin pull/${prNumber}/head:pr-${prNumber}`, { stdio: 'ignore' });
            execSync(`git cat-file -e ${sha}`, { stdio: 'ignore' });
            return true;
        } catch {
            // fall through to generic fetch
        }
    }

    // Try to fetch from origin by branch/sha
    try {
        execSync(`git fetch origin ${sha}`, { stdio: 'ignore' });
        execSync(`git cat-file -e ${sha}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// Determine if a string looks like a Git SHA (7 to 40 hex chars)
function getIsSha(value) {
    if (!value) return false;
    const v = String(value).trim();
    return /^[0-9a-f]{7,40}$/i.test(v);
}

// Sanitize a git ref to a safe subset to avoid shell injection and invalid refs.
// Allows letters, digits, dot, underscore, hyphen, slash. Rejects dangerous patterns.
function sanitizeRef(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    // Disallow leading dash (could be treated as option), double dots, path traversal, lock file names, and special sequences.
    if (/^-/.test(v)) return '';
    if (v.includes('..')) return '';
    if (v.endsWith('.') || v.endsWith('/')) return '';
    if (v.includes('@{')) return '';
    if (v.includes('//')) return '';
    if (/\.lock(\b|$)/.test(v)) return '';
    // Only allow a conservative character set
    if (!/^[A-Za-z0-9._\/-]+$/.test(v)) return '';
    return v;
}

/**
 * Resolve a ref (branch name, tag, or SHA) to a commit SHA.
 * Strategy:
 * 1) Try `git rev-list -n 1 <ref>` locally (works for branches, tags, and SHAs).
 * 2) If it fails and we have an origin, try fetching the specific ref from origin then retry (also try origin/<ref>).
 * 3) As a fallback for SHA-like inputs, verify presence via ensureCommitExists (which may fetch by SHA or PR ref).
 * Returns empty string if resolution fails.
 */
function extractSha(ref, prNumber) {
    const r = (ref || '').trim();
    if (!r) return '';

    if (getIsSha(r)) {
        if (ensureCommitExists(r, prNumber)) return r;
    }

    const safeRef = sanitizeRef(r);
    if (!safeRef) return '';

    // Note: safeRef has been sanitized to a conservative character set to avoid command injection.
    const tryRevListRef = (name) => {
        try {
            const out = execSync(`git rev-list -n 1 ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            return out || '';
        } catch {
            return '';
        }
    };
    const tryRevList = () => tryRevListRef(safeRef);

    // First attempt: resolve locally
    let sha = tryRevList();
    if (sha) return sha;

    // If not resolvable locally, try to fetch from origin
    if (hasRemoteOrigin()) {
        try {
            // Try fetching the specific ref (works for branches and tags)
            execSync(`git fetch origin ${safeRef}`, { stdio: 'ignore' });
        } catch {
            // If specific fetch failed, try a broader fetch (including tags)
            try {
                execSync('git fetch --tags --quiet origin', { stdio: 'ignore' });
            } catch { }
            // Some environments (or remotes with only tags and no heads) may not bring tag refs
            // into the local tag namespace via a generic fetch. As a final attempt, explicitly
            // fetch the single tag by name.
            try {
                execSync(`git fetch origin tag ${safeRef}`, { stdio: 'ignore' });
            } catch { }
        }
        // Try the provided name, then explicit tag ref, then origin/<name> (for branches)
        sha = tryRevList();
        if (!sha) sha = tryRevListRef(`origin/${safeRef}`);
        if (!sha) sha = tryRevListRef(`refs/tags/${safeRef}`);
        if (sha) return sha;

        // As a last resort, resolve tag directly from remote without fetching
        try {
            const out = execSync(`git ls-remote --tags origin ${safeRef}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            // Expect lines like: "<sha>\trefs/tags/<name>" (possibly with ^{} for annotated tags)
            const line = out.split(/\r?\n/).find(l => l.includes(`refs/tags/${safeRef}`));
            if (line) {
                const m = line.match(/^([0-9a-f]{7,40})\s+/i);
                if (m && m[1] && getIsSha(m[1])) {
                    return m[1];
                }
            }
        } catch { }
    }

    return '';
}

function run() {
    try {
        console.log(`🔍 Getting Changed Files between '${process.env.INPUT_BASE_REF}' and '${process.env.INPUT_HEAD_REF}'`);
        console.log('========================================');

        const baseRef = process.env.INPUT_BASE_REF || '';
        const headRef = process.env.INPUT_HEAD_REF || '';
        const prNumber = process.env.GITHUB_PR_NUMBER || '';

        const baseSha = extractSha(baseRef, prNumber);
        const headSha = extractSha(headRef, prNumber);

        if (baseRef && !baseSha) {
            if (getIsSha(baseRef)) {
                throw new Error(`Base SHA ${baseRef} not found and could not be fetched.`);
            }
            throw new Error(`Could not resolve base ref '${baseRef}' to a commit SHA.`);
        }
        if (headRef && !headSha) {
            if (getIsSha(headRef)) {
                throw new Error(`Head SHA ${headRef} not found and could not be fetched.`);
            }
            throw new Error(`Could not resolve head ref '${headRef}' to a commit SHA.`);
        }

        // Double-check the resolved SHAs exist (and fetch if needed for PR/remote-only SHAs)
        if (baseSha && !ensureCommitExists(baseSha, prNumber)) {
            throw new Error(`Base SHA ${baseSha} not found and could not be fetched.`);
        }
        if (headSha && !ensureCommitExists(headSha, prNumber)) {
            throw new Error(`Head SHA ${headSha} not found and could not be fetched.`);
        }

        let gitCommand;
        if (baseSha && headSha) {
            gitCommand = `git diff --name-only ${baseSha}...${headSha}`;
        } else if (baseSha) {
            gitCommand = `git diff --name-only ${baseSha}...HEAD`;
        } else {
            gitCommand = 'git diff --name-only';
        }
        console.log('Git command:', gitCommand);
        const files = execSync(gitCommand, { encoding: 'utf8' }).trim();

        console.log('\n=== Changed Files ===');
        if (files) {
            console.log(files);
        } else {
            console.log('(no files changed)');
        }
        console.log('====================\n');

        if (!files) {
            console.log('No changed files found.');
            fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_files=[]\n`);
            console.log('✅ Complete - no changes detected');
            process.exit(0);
        }

        // Convert newline-separated files to JSON array
        const fileList = files.split('\n').filter(f => f.trim());
        const json = JSON.stringify(fileList);

        // Write to GITHUB_OUTPUT
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed_files=${json}\n`);
        console.log('✅ Complete - outputs written successfully');
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = { run, ensureCommitExists, extractSha };