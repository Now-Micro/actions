# GitHub Actions Monorepo

## Action Structure Pattern
Each action follows a consistent pattern:

1. A folder named after the action.
2. `action.yml` (composite action definition) calls a standalone JavaScript file (no inline JS blocks).
3. The JavaScript implementation file: `something.js` (exporting `run()` where practical).
4. A colocated test file: `something.test.js` using the built‑in Node test runner (`node:test`).
5. Inputs are passed to JS via environment variables prefixed with `INPUT_` (mirrors how GitHub injects action inputs when using JavaScript actions directly).
6. Outputs are written by appending `name=value` lines to the file pointed to by `GITHUB_OUTPUT`.

Example mapping (from `get-project-and-solution-files-from-directory`):
- `action.yml` step runs: `node "$GITHUB_ACTION_PATH/get-project-and-solution-files-from-directory.js`"
- Inputs -> env: `INPUT_DIRECTORY`, `INPUT_MAX_DEPTH`, etc.
- JS writes outputs: `solution-found=...`, `project-found=...`.
- Tests exercise edge cases (depth limits, multiple matches, invalid input) for 100% coverage.

## Running Tests Locally
Prerequisites: Node.js 20.x (the repo action `setup-node` also defaults to 20.x).

From the repository root (PowerShell):

Run all tests:
```
node --test
```

Run tests in a single action folder:
```
node --test get-changed-files/*.test.js
```

Show coverage (uses `c8` – install once globally or use npx):
```
npx --yes c8 -r text -r lcov node --test
```
The `lcov` report (`coverage/lcov.info`) can be consumed by coverage services.

Fail fast on first failure:
```
node --test --test-reporter tap | Select-String -NotMatch "ok" | Select-String -Pattern "not ok"
```
(Or rely on default non‑zero exit code.)

## Adding a New Action
1. Create a folder: `my-new-action/`.
2. Write `action.yml` as a composite action. Keep logic out of the YAML; only call your JS:  
   `run: node "$GITHUB_ACTION_PATH/my-new-action/main.js`"
3. Implement `main.js` exporting any helpers plus `run()` guarded by `if (require.main === module) run();`.
4. Add `main.test.js` with scenarios (success, error paths, edge cases). Mock filesystem / env / process exit similarly to existing tests.
5. Use env-based input injection (`INPUT_<UPPER_SNAKE>`). Translate in JS with `process.env.INPUT_NAME`.
6. Write outputs to `process.env.GITHUB_OUTPUT`.
7. Run `node --test` and ensure coverage shows all lines executed (via `npx c8 ...`).

## Conventions
- No external test frameworks (keep dependencies zero for speed & simplicity).
- Prefer small pure functions that are exported and directly testable.
- Keep side effects (filesystem, git, network) isolated for easier mocking.
- Log with concise, user‑friendly messages (emoji optional) – tests should assert behavior via outputs rather than fragile log strings unless validating error paths.

## Troubleshooting
- Missing outputs: ensure `GITHUB_OUTPUT` is set in tests; mimic existing test harnesses.
- Windows path issues: prefer forward slashes only when interacting with Git commands; use `path.join` elsewhere.
- Depth logic: remember `currentDepth > maxDepth` guard; tests should cover boundary (`maxDepth` exactly meets the target directory).

## Notes
These actions have only been tested on Linux runners.
