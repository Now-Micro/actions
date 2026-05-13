# Reusable Workflows and Composite Actions

This directory contains GitHub Actions **reusable workflows** — shared workflow definitions that any repository in the organization can call, as well as workflows that run on this repository directly.

## Table of Contents

- [Background: Reusable Workflows vs Composite Actions](#background-reusable-workflows-vs-composite-actions)
  - [Reusable Workflows](#reusable-workflows)
  - [Composite Actions](#composite-actions)
  - [When to use which](#when-to-use-which)
- [Reusable Workflows in this Repo](#reusable-workflows-in-this-repo)
  - [Reusable Checks Workflow](#reusable-checks-workflow)
    - [What it does](#reusable-checks-what-it-does)
    - [Inputs](#reusable-checks-inputs)
    - [Secrets](#reusable-checks-secrets)
    - [Base-ref optimization](#reusable-checks-base-ref-optimization)
    - [Usage - called from a PR workflow](#reusable-checks-usage---called-from-a-pr-workflow)
    - [Usage - check one directory explicitly](#reusable-checks-usage---check-one-directory-explicitly)
  - [NuGet Publish Workflow](#nuget-publish-workflow)
    - [What it does](#nuget-publish-what-it-does)
    - [Trigger](#nuget-publish-trigger)
    - [Inputs](#nuget-publish-inputs)
    - [Secrets](#nuget-publish-secrets)
    - [Single Directory Case](#nuget-publish-usage---called-from-another-workflow)
    - [Multi-Directory Case](#nuget-publish-usage---automatic-trigger-on-release-branch-push)
  - [Pre-Release NuGet Workflow](#pre-release-nuget-workflow)
    - [What it does](#pre-release-nuget-what-it-does)
    - [Inputs](#pre-release-nuget-inputs)
    - [Secrets](#pre-release-nuget-secrets)
    - [Usage - auto-detect changed packages on a PR](#pre-release-nuget-usage---auto-detect-changed-packages-on-a-pr)
    - [Usage - publish a specific directory](#pre-release-nuget-usage---publish-a-specific-directory)
    - [Version format](#pre-release-nuget-version-format)
  - [npm Publish Workflow](#npm-publish-workflow)
    - [What it does](#npm-publish-what-it-does)
    - [Inputs](#npm-publish-inputs)
    - [Secrets](#npm-publish-secrets)
    - [Security notes](#npm-publish-security-notes)
    - [Usage](#npm-publish-usage)

---

## Background: Reusable Workflows vs Composite Actions

### Reusable Workflows

A **reusable workflow** is a complete `.yml` workflow file that exposes a `workflow_call` trigger. Another workflow can call it using the `uses:` key at the **job** level. Each job in the reusable workflow runs on its own runner (just like a normal workflow job), which means it can use `needs:`, `strategy: matrix:`, and `if:` conditions across jobs.

Key properties:

- Called at the **job** level via `uses:` in another workflow.
- The called workflow's jobs appear as separate jobs in the Actions run UI.
- Inputs and secrets are declared explicitly under `workflow_call:`.
- Can fan out work across a matrix of parallel jobs.
- Cannot be nested inside a step — use a composite action for that.

```yaml
# Calling a reusable workflow
jobs:
  publish:
    uses: Now-Micro/actions/.github/workflows/nuget-publish.yml@v1
    with:
      package: MyLibrary
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

### Composite Actions

A **composite action** lives in an `action.yml` file inside a directory and is called from the `uses:` key at the **step** level. It executes inline within the calling job — no separate runner is spun up.

Key properties:

- Called at the **step** level via `uses:` inside a job.
- Steps execute on the caller's runner.
- Inputs and outputs are declared in the action's `action.yml`.
- Ideal for encapsulating a sequence of steps that should run together in one job.
- Cannot span multiple jobs or use a job matrix.

```yaml
# Calling a composite action
steps:
  - uses: Now-Micro/actions/nuget/publish@v1
    with:
      project-file: src/MyLib/MyLib.csproj
      github-token: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

### When to use which

| Scenario | Use |
|---|---|
| Fan out work across multiple parallel jobs (e.g. per-directory publish) | Reusable workflow |
| Sequence of steps that must share the same runner/workspace | Composite action |
| Wrap logic for use inside an existing job | Composite action |
| Enforce consistent job-level permissions and secrets | Reusable workflow |

---

## Reusable Workflows in this Repo

### Reusable Checks Workflow

Runs the repo's shared PR checks: linting, coding standards, and tests. It is designed to be called from PR workflows so consumers can pass in the branch context and, optionally, a specific directory to check.

#### Reusable Checks What it does

1. Runs CSharpier linting when `enable-linting` is `true`.
2. Resolves the directories to check for coding standards and tests.
3. Runs coding standards checks for each resolved directory.
4. Runs tests for each resolved directory.
5. Uploads test result artifacts for each test matrix entry.

#### Reusable Checks Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `enable-linting` | No | `false` | Run CSharpier linting. |
| `enable-coding-standards` | No | `false` | Run coding standards checks. |
| `enable-testing` | No | `false` | Run tests. |
| `ci-debug-mode` | No | `false` | Enable verbose debug logging for discovery steps. |
| `directory` | No | `""` | Specific directory to check. When empty, the workflow detects changed directories. |
| `head-ref` | No | `""` | Head commit SHA to compare against the base. Pass `github.event.pull_request.head.sha` from PR workflows. |
| `coding-standards-path-pattern` | No | `^([^/.]+)/` | Regex used to find changed directories for coding standards checks. |
| `roslyn-version` | No | `""` | Optional override for the Roslyn analyzer package version. |
| `optimize-base-ref` | No | `false` | Compare test changes against the last successful run on the branch when possible. |
| `testing-path-pattern` | No | `^([^/]+)/(?:(src|tests?)/.*\.(cs|csproj|sln|slnx)|.*\.(sln|slnx))$` | Regex used to find changed directories for tests. |
| `transformer` | No | `s#(^|/)src/(.*)$#$1tests/$2.Tests#` | Transform source directories into test directories. |
| `use-original-if-missing` | No | `false` | Keep the original path when the transformed test directory does not exist. |
| `fail-fast` | No | `false` | Cancel remaining test matrix jobs when one fails. |
| `test-args` | No | `""` | Additional arguments passed to `dotnet test`. |
| `dotnet-version` | No | `8.0.x` | .NET SDK version(s) to use when running tests. |
| `test-project-regex` | No | `""` | Regex used to identify the test project file. |
| `solution-regex` | No | `""` | Regex used to identify the solution file. |
| `prefer-solution` | No | `false` | Prefer a solution file over individual projects for testing. |
| `workflow-name` | No | `""` | Workflow filename used when looking up the last successful run for optimization. |
| `caller-job-name` | No | `""` | The name of the job in the calling workflow that invokes this reusable workflow (e.g. `checks`). Required when `optimize-base-ref` is `true`. GitHub prefixes every job name in the API response with the caller's job name (e.g. `checks / test-setup`), so this must be provided for the last-successful-run lookup to match correctly. See [Base-ref optimization](#base-ref-optimization) below. |
| `overridden-changed-files` | No | `""` | JSON array of file paths to treat as changed. Skips git change detection entirely. Intended for testing and demo scenarios. |

#### Reusable Checks Secrets

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | No | Optionally required depending on project.  PAT with `read:packages` permission for restoring NuGet packages from GitHub Packages. |

#### Reusable Checks Base-ref optimization

When `optimize-base-ref: "true"` and `workflow-name` is set, the `test-setup` job compares changed files against the SHA of the last successful run on the branch (rather than the default branch), so tests only run for files that have changed since the last green build.

Because the workflow is called as a reusable workflow, GitHub prefixes all job names in the API with the caller's job name. For example, if your calling job is named `checks`, the API reports jobs as `checks / test-setup`, `checks / test (...)`. The lookup will fail to find any matching runs unless you also pass `caller-job-name: "checks"` to tell the workflow what prefix to expect.

```yaml
jobs:
  checks:
    uses: Now-Micro/actions/.github/workflows/reusable-checks.yml@v1
    with:
      optimize-base-ref: "true"
      workflow-name: checks.yml
      caller-job-name: checks   # must match the job key above
      ...
```

#### Single Directory Case

```yaml
jobs:
  checks:
    uses: Now-Micro/actions/.github/workflows/reusable-checks.yml@v1
    with:
      caller-job-name: checks
      dotnet-version: "8.0.x"
      enable-linting: "true"
      enable-coding-standards: "true"
      enable-testing: "true"
      head-ref: ${{ github.event.pull_request.head.sha }}
      optimize-base-ref: "true"
      roslyn-version: "4.9.2"
      test-project-regex: '.*Tests\.csproj\s*$'
      workflow-name: checks.yml
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

#### Multi-Directory Case

```yaml
jobs:
  checks:
    uses: Now-Micro/actions/.github/workflows/reusable-checks.yml@v1
    with:
      caller-job-name: checks
      ci-debug-mode: ${{ vars.ENABLE_TEST_DEBUGGING }}
      directory: "./" # this is the trigger to change the mode
      prefer-solution: "true" # test the solution file
      dotnet-version: ${{ vars.CHECKS_DOTNET_SDK_VERSION }}
      enable-linting: ${{ vars.ENABLE_LINTING }}
      enable-coding-standards: ${{ vars.ENABLE_CODING_STANDARDS }}
      enable-testing: ${{ vars.ENABLE_TESTING }}
      head-ref: ${{ github.event.pull_request.head.sha }} # assumes the trigger for the workflow is a PR.  May differ based on exact use case
      roslyn-version: ${{ vars.ROSLYN_ANALYZER_VERSION }}
      test-args: ${{ vars.CHECK_TEST_ARGS }}
      workflow-name: checks.yml # the name of the workflow yml file that this job is running in
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

---

### NuGet Publish Workflow

Builds, packs, and publishes a versioned NuGet package from a release branch, then creates a GitHub release with the generated artifacts. Intended to run automatically when a `release/**` branch is pushed, or to be called explicitly from another workflow.

#### NuGet Publish What it does

1. Checks out the repository.
2. Validates the release ref and extracts the package name and version from it.
3. Finds the matching `.csproj` file.
4. Extracts the changelog entry for the release version.
5. Builds and packs the project, running tests if a test directory is specified.
6. Uploads artifacts and creates a GitHub release with release notes.

#### NuGet Publish Trigger

Runs automatically on `push` to any `release/**` branch, or on `workflow_call`.

#### NuGet Publish Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `artifact-retention-days` | No | `1` | Number of days to retain build artifacts. |
| `ci-debug-mode` | No | `false` | Enable debug logging for project discovery and publish steps. |
| `ignore-casing` | No | `true` | Ignore casing when matching package names and parsing refs. |
| `nuget-urls` | No | — | Comma-separated NuGet feed URLs needed to restore packages. |
| `package` | No | — | Package name to release (overrides extraction from `ref-name`). |
| `package-directory` | No | `nupkgs` | Directory to store generated `.nupkg` files. |
| `ref-name` | No | `github.ref_name` | Release ref to parse (e.g. `release/MyLib/1.2.3`). |
| `release-dotnet-version` | No | `10.0.x` | .NET SDK version(s) to use when building. Comma-separated for multiple. |
| `release-workflow-debug-mode` | No | `true` | Enable debug logging for release validation and publishing. |
| `tests-directory` | No | — | Directory containing the test project. Leave empty to skip tests. |
| `version` | No | — | Explicit version to publish. Extracted from `ref-name` when empty. |

#### NuGet Publish Secrets

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | Yes | PAT with `read:packages` and `write:packages` permissions for pushing to GitHub Packages. |

#### NuGet Publish Usage - called from another workflow

```yaml
jobs:
  release:
    uses: Now-Micro/actions/.github/workflows/nuget-publish.yml@v1
    with:
      package: MyLibrary
      release-dotnet-version: "8.0.x"
      tests-directory: "src/MyLibrary/tests"
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

#### NuGet Publish Usage - automatic trigger on release branch push

Simply push or merge to a branch named `release/MyLibrary/1.2.3`. The workflow will pick up the package name (`MyLibrary`) and version (`1.2.3`) from the branch name automatically.

```bash
git checkout -b release/MyLibrary/1.2.3
git push origin release/MyLibrary/1.2.3
```

---

### Pre-Release NuGet Workflow

Detects which project directories have changed and publishes a timestamped pre-release NuGet package for each one. Designed to be called on pull requests or feature branches to publish an `alpha`/`beta`/`rc`/`preview` build that consumers can test before a full release.

#### Pre-Release NuGet What it does

When `directory` is **not** provided:

1. Gets the list of changed files between the current commit and the base ref.
2. Extracts unique `src/` project directories from that file list based on the `nuget-pattern-to-match` input.
3. Fans out into a matrix job — one publish job per changed directory.

When `directory` **is** provided:

1. Skips change detection and publishes the specified directory directly.

In both cases, for each directory:

1. Finds the `.csproj` file based on the `nuget-project-regex` input value.
2. Calculates a pre-release version (e.g. `1.2.4-alpha-202506011200`) by incrementing the current version and appending an identifier and UTC timestamp.
3. Builds, packs, and pushes the package to the NuGet feed.
4. Uploads the artifacts and generates a pre-release summary.

#### Pre-Release NuGet Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `artifact-retention-days` | No | `1` | Number of days to retain uploaded artifacts. |
| `base-ref` | No | default branch | Base ref/branch to compare changes against. |
| `ci-debug-mode` | No | `false` | Enable verbose logging for project discovery and publish steps. |
| `directory` | No | — | Specific directory to publish. When set, change detection is skipped. |
| `dotnet-version` | No | `8.0.x` | .NET SDK version(s) to install. Comma-separated for multiple. |
| `nuget-package-dir` | No | `nupkgs` | Subdirectory within each project directory to write `.nupkg` files. |
| `nuget-pattern-to-match` | No | `^(.*/src)/.*\.(cs\|csproj\|sln)$` | Regex to match changed files. Must include a capture group for the project directory. |
| `nuget-project-regex` | No | `.*\.csproj$` | Regex to locate the `.csproj` file within a directory. |
| `nuget-urls` | **Yes** | — | Comma-separated NuGet feed URL(s) to publish to. |
| `prerelease-identifier` | No | `alpha` | Label to embed in the version string (`alpha`, `beta`, `preview`, `rc`). |
| `version-increment-type` | No | `none` | How to increment the version (`major`, `minor`, `patch`, or `none`). |

#### Pre-Release NuGet Secrets

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | Yes | PAT with `read:packages` and `write:packages` permissions. |

#### Pre-Release NuGet Usage - auto-detect changed packages on a PR

```yaml
jobs:
  pre-release:
    uses: Now-Micro/actions/.github/workflows/reusable-pre-release.yml@v1
    with:
      base-ref: main
      nuget-urls: "https://nuget.pkg.github.com/my-org/index.json"
      prerelease-identifier: "alpha"
      version-increment-type: "patch"
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

#### Pre-Release NuGet Usage - publish a specific directory

```yaml
jobs:
  pre-release:
    uses: Now-Micro/actions/.github/workflows/reusable-pre-release.yml@v1
    with:
      directory: "src/MyLibrary"
      nuget-urls: "https://nuget.pkg.github.com/my-org/index.json"
      prerelease-identifier: "beta"
      version-increment-type: "minor"
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

#### Pre-Release NuGet Version format

Pre-release versions follow the pattern:

```
{base-version}-{identifier}-{YYYYMMDDHHmm}
```

For example, if the `.csproj` contains `<VersionPrefix>1.2.3</VersionPrefix>` and `version-increment-type` is `patch`, the published version will be something like:

```
1.2.4-alpha-202506011430
```

---

### npm Publish Workflow

Installs dependencies, publishes a scoped npm package to GitHub Packages (or another npm registry), and creates a GitHub Release for real publishes when a GitHub token is provided. Intended to be called from a workflow that runs on `main` after a version has been set in `package.json`.

#### npm Publish What it does

1. Validates that the required secret and the `access` input are present and valid.
2. Checks out the repository.
3. Configures Node.js and the `.npmrc` for the target registry and scope.
4. Extracts and validates the changelog entry for the package version before any dependency installation.
5. Runs `npm ci` when a lockfile exists in the specified `package-directory`, otherwise falls back to `npm install --no-package-lock`.
6. Runs `npm publish` with the configured access level and distribution tag.
7. Creates a GitHub Release using the forwarded `GITHUB_TOKEN` unless `dry-run` is `true`.

#### npm Publish Inputs

| Name | Required | Default | Description |
|---|---|---|---|
| `access` | No | `restricted` | Package access level. Use `public` for public packages or `restricted` for private/org-scoped packages. |
| `ci-debug-mode` | No | `false` | Enable verbose debug logging during the publish steps. |
| `dry-run` | No | `false` | When `true`, runs `npm publish --dry-run`. No package is actually published. |
| `node-version` | No | `22.x` | Node.js version to use when installing and publishing. |
| `package-directory` | **Yes** | — | Directory containing the `package.json` to publish. Relative to the repository root. |
| `registry-url` | No | `https://npm.pkg.github.com` | npm registry URL to publish to. |
| `scope` | No | `""` | npm package scope (e.g. `@my-org`). Must match the scope prefix in the `package.json` name field. Required when publishing to GitHub Packages. |
| `tag` | No | `latest` | npm distribution tag applied to the published version (e.g. `latest`, `next`, `beta`). |
| `test-directory` | No | `""` | Directory containing the `package.json` whose test script should be run. Defaults to `package-directory` when `test-script` is set and this is empty. |
| `test-script` | No | `""` | npm script name to run before publishing (e.g. `test`, `test:ci`). When empty, the test step is skipped. If the script exits non-zero, the workflow stops and nothing is published. |

#### npm Publish Secrets

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | Yes | PAT with `write:packages` permission used to authenticate to the npm registry. |

#### npm Publish Security notes

- The token is passed to npm via the `NODE_AUTH_TOKEN` environment variable, not embedded in `.npmrc`. It is never echoed to logs.
- The job only runs when the workflow is triggered from `main` (`github.ref_name == 'main'`), preventing accidental publishes from feature branches.
- Use a PAT scoped to `write:packages` only — do not use a token with broader permissions.
- The reusable workflow runs with `contents: write` so the composite action can create a GitHub Release on real publishes. Dry runs skip release creation.
- The `package.json` version must be bumped before calling this workflow. Do not republish the same version.

#### npm Publish Usage

```yaml
jobs:
  publish:
    uses: Now-Micro/actions/.github/workflows/reusable-npm-publish.yml@v1
    with:
      package-directory: "src/my-library"
      scope: "@my-org"
      access: "restricted"
      tag: "latest"
    secrets:
      token-github-packages: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```
