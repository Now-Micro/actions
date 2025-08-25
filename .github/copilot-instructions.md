# Copilot Project Instructions

This repository is a monorepo of custom GitHub Composite Actions plus supporting demo & test assets. The goal is high signal, low dependency actions with deterministic, testable behavior. Follow the established patterns below when reading, modifying, or adding code. Make sure to read all of the individual instructions in `.github/instructions/`.  Some may not apply to the task at hand, so only apply the relevant ones.

## Architecture & Patterns
- Each action lives in its own top-level folder: `action-name/` containing:
  - `action.yml` (composite) that only orchestrates steps (no inline business logic).
  - A single JS implementation file (`<action>.js`) exporting `run()` and guarded by `if (require.main === module) run();`.
  - A colocated test file (`<action>.test.js`) using the built‑in `node:test` runner (no external frameworks) achieving near 100% line & branch coverage.
- Inputs are surfaced to JS via env vars `INPUT_<UPPER_SNAKE_CASE>`, mirroring how GitHub injects inputs for JavaScript actions. Composite YAML sets these under `env:`.
- Outputs are appended as lines to the file at `GITHUB_OUTPUT` (format: `name=value`). Tests set `GITHUB_OUTPUT` to a temp file and assert its contents.
- Logging uses concise plain text with optional emoji (e.g. `🔍`). Tests rarely assert on logs except for error/edge cases.
- Error paths intentionally call `process.exit(1)` after printing a clear message (tests capture by monkey‑patching `process.exit`).

## Testing Conventions
- Use built‑in `node:test` with minimal harness helpers (`withEnv`, custom `execAssertion`, etc.).
- Tests isolate side effects: temp directories created via `fs.mkdtempSync(os.tmpdir())` and cleaned up. No global state leakage.
- Pattern: wrap `process.exit` to capture exit codes; restore after each test.
- Provide scenarios: success, edge, invalid input (missing env, invalid regex, unreadable directories), duplication handling, depth boundaries.
- Coverage gathering (manual): `npx --yes c8 -r text -r lcov node --test`.

## Workflow Demo Pattern
- When adding a demo: follow guidance in `.github/instructions/demo-workflows.md`.

## Adding / Modifying Actions
1. Create folder + `action.yml` referencing new JS file (no inline heredoc JS).
2. The `action.yml` file should use `run: node "$GITHUB_ACTION_PATH/my-new-js-file.js"` instead of just `node ./some-action-name/my-new-js-file.js` to ensure that the correct path is used when used by an external repository's workflow.
3. Implement `run()`; resolve & validate all required inputs early; exit with code 1 on error.
4. Write exhaustive tests first (aim for full statement/branch coverage, especially around regex or traversal logic).  See [this](../get-unique-root-directories/unique-root-directories.test.js) for an example.
5. Avoid external dependencies unless absolutely necessary (currently zero NPM deps).
6. Keep logs stable & human friendly; do not encode control sequences that complicate summary parsing.
7. Add a demo workflow in `.github/workflows/` referencing a new composite action in `.github/actions/` that uses `testing/assert` for verifications. Follow the guidance established in `.github/instructions/demo-workflows.md`

## Refactoring
- Analyze the existing implementation.  If it makes sense to separate the code into smaller composite action, propose it to the user and ask how to proceed.
- Make sure to follow the same file structure and patterns as outlined above.
- Make sure to add tests for the new composite action and follow the testing conventions outlined above.

## Project-Specific Nuances
- BFS vs DFS: Finder action intentionally uses BFS to select the shallowest matching project/solution; do not revert to DFS.
- Regex capture expectation: `get-unique-root-directories` relies on group 1; patterns must include a capturing group—document this in consumer workflows.
- Assertion action treats missing `INPUT_ACTUAL` as allowed only for `absent` mode.
- Windows environment: Paths may run on Windows runners; use `path.join` except when intentionally producing POSIX style paths for git diff compatibility.

## Common Utilities/Idioms
- Environment parsing is simple & explicit; no abstraction layers—stay consistent.
- For multiline outputs (like changelog content) use GitHub heredoc (`<<EOF`). For single-line JSON arrays just append directly.
- Tests may assert output file contains exact JSON (ordering preserved by insertion order of Set or BFS scan).

## Quick Commands
Run all tests: `node --test`
Run single action tests: `node --test get-unique-root-directories/*.test.js`
Generate coverage: `npx --yes c8 -r text -r lcov node --test`

## When in Doubt
Mirror existing action structure; look at `get-project-and-solution-files-from-directory` for traversal + debug, and `testing/assert` for env parsing & exit handling.

Provide any new or updated patterns here to keep AI guidance current.
