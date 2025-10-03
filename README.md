# GitHub Actions Monorepo

This repository serves as a centralized source for reusable GitHub Actions across the organization. It contains a collection of custom composite actions designed for high signal, low dependency workflows. Actions are built with deterministic behavior, comprehensive testing, and minimal external dependencies.

## Creating New Actions

To add a new reusable action:

1. **Create the action folder**: `mkdir my-new-action/`
2. **Write `action.yml`**: Define it as a composite action. Avoid inline logic; call your JS file:
   ```yaml
   runs:
     using: 'composite'
     steps:
       - run: node "$GITHUB_ACTION_PATH/my-new-action.js"
         shell: bash
   ```
3. **Implement the JS file**: `my-new-action.js` with exported functions and a `run()` entry point.
4. **Add tests**: `my-new-action.test.js` covering success, error, and edge cases. Use mocks for filesystem/git/network. Aim for 100% line/branch coverage.
5. **Handle inputs/outputs**: Read from `process.env.INPUT_*`, write to `process.env.GITHUB_OUTPUT`.
6. **Test locally**: Run `node --test my-new-action/*.test.js` and check coverage with `npx c8 -r text node --test`.

Ensure the action is self-contained, with no external dependencies beyond Node.js standard library.

## Prerequisites

- Node.js 20.x (matches the default version in the `setup-node` action).
- Git for local development and testing.

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

From the repo root:

- **Run all tests**: `node --test`
- **Run specific tests**: `node --test get-changed-files/*.test.js`
- **Coverage**: `npx --yes c8 -r text -r lcov node --test`
- **Fail fast**: `node --test --test-reporter tap | Select-String -NotMatch "ok" | Select-String -Pattern "not ok"`

Tests validate edge cases like invalid inputs, depth limits, and filesystem interactions.

## Adding a New Action
1. Create a folder: `my-new-action/`.
2. Write `action.yml` as a composite action. Keep logic out of the YAML; only call your JS:  
   `run: node "$GITHUB_ACTION_PATH/my-new-action/main.js`"
3. Implement `main.js` exporting any helpers plus `run()` guarded by `if (require.main === module) run();`.
4. Add `main.test.js` with scenarios (success, error paths, edge cases). Mock filesystem / env / process exit similarly to existing tests.
5. Use env-based input injection (`INPUT_<UPPER_SNAKE>`). Translate in JS with `process.env.INPUT_NAME`.
6. Write outputs to `process.env.GITHUB_OUTPUT`.
7. Run `node --test` and ensure coverage shows all lines executed (via `npx c8 ...`).

## Using the Created Actions

To use an action from this repo in your workflow:

1. **Reference the action**: Use the full path or a local reference if in the same repo.
   ```yaml
   - uses: Now-Micro/actions/get-changed-files@v1  # For version 1
   - uses: ./get-changed-files  # If using locally in this repo (e.g. in a demo file)
   ```
2. **Provide inputs**: Pass parameters as defined in the action's `action.yml`.
   ```yaml
   with:
     head-ref: ${{ github.head_ref }}
     base-ref: main
   ```
3. **Consume outputs**: Access results in subsequent steps.
   ```yaml
   - run: echo "Changed files: ${{ steps.my-step.outputs.changed_files }}"
   ```

Check each action's `action.yml` or README for specific inputs, outputs, and usage examples. Actions are designed for reliability in CI/CD pipelines.

## Releasing a New Version

Releases are managed via the `release.yml` workflow, which creates GitHub releases for tagging action versions.

### Triggering a Release

1. Go to the **Actions** tab in this repo.
2. Select the **Release** workflow.
3. Click **Run workflow** and fill in the inputs:
   - **Tag**: The version tag (e.g., `v2`).
   - **Name**: Release name (defaults to the tag if empty).
   - **Body**: Release notes (ignored if auto-generating notes).
   - **Target**: Commitish (branch or SHA; defaults to `main`).
   - **Draft/Prerelease**: Mark as draft or prerelease.
   - **Generate Release Notes**: Auto-generate from PRs/commits.
   - **Should Delete Existing Release/Tag**: Delete existing release/tag if it exists.
   - **Skip Tests**: Skip running tests (default: true for faster releases).

The workflow runs tests, creates or updates the release, and provides outputs like `release_id`, `html_url`, and `upload_url` for further automation.

### Best Practices
- Use simple versioning (e.g., `v1`, `v2`, `v3`, ...).
- Tag releases after merging changes to `main`.
- Enable auto-generated notes for changelog summaries.
- If updating an action, ensure backward compatibility or bump version.

## Conventions

- **Testing**: Use built-in `node:test` only; no external frameworks. Export pure functions for direct testing. Mock side effects (e.g., filesystem, git commands).
- **Inputs/Outputs**: Env-based for JS; document clearly in `action.yml`.
- **Logging**: Concise, user-friendly messages. Tests assert outputs, not logs (except errors).
- **Dependencies**: Zero external NPM deps to keep actions lightweight.
- **Paths**: Use `path.join` for cross-platform; forward slashes for Git commands.
- **Error Handling**: Exit with code 1 on errors; provide clear messages.
- **Coverage**: Target 100% line/branch coverage; use `c8` for reporting.

## Troubleshooting

- **Missing outputs**: Ensure `GITHUB_OUTPUT` is set in tests; mimic existing harnesses.
- **Windows paths**: Use `path.join` for local paths; forward slashes for Git.
- **Depth logic**: Guard with `currentDepth > maxDepth`; test boundaries.
- **Git commands**: Handle errors from `execSync`; test with mocked repos.
- **Regex patterns**: Validate in ignore parameters; test invalid patterns.
- **Permissions**: Ensure workflows have `contents: write` for releases.
- **Test failures**: Check coverage gaps; add scenarios for untested paths.

If issues persist, review action-specific READMEs or test files for examples.

## Demo Workflows and Testing

This repository includes demo workflows and testing actions to validate and showcase the actions.

### Demo Workflows

Demo workflows are located in `.github/workflows/` and demonstrate practical usage of the actions in CI/CD pipelines. They serve as examples for consumers and are built following the guidelines in `.github/instructions/demo-workflows.md`. Each demo workflow tests specific action functionality and can be used as a starting point for integration.

### Node Tests Workflow

The `run-node-tests` action (in `.github/actions/run-node-tests/`) is a composite action designed for running Node.js tests in CI environments. It handles test execution, coverage reporting, and failure handling across different Node.js versions and environments.

## Notes

- Actions are tested on Linux runners; Windows/macOS may have path differences.
- For local scripts (e.g., `clean-up-git-branches.ps1`), see inline comments for usage.
- Contributions: Follow the pattern; add tests first; update this README if adding new sections.
