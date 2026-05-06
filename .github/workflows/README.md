# Reusable Workflows

This directory contains GitHub Actions **reusable workflows** — shared workflow definitions that any repository in the organization can call, as well as workflows that run on this repository directly.

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

## Reusable Workflows

### `reusable-authorize.yml` — Authorize Workflow

Checks whether the triggering actor is authorized to run the calling workflow. Intended to be used as a guard job at the start of sensitive workflows.

**What it does:**

1. Logs the current GitHub context (actor, repository, workflow ref).
2. Calls the `Now-Micro/actions/authorize` composite action to perform the authorization check.
3. Outputs an `authorized` boolean that subsequent jobs can gate on via `needs` and `if`.

**Outputs**

| Name | Description |
|---|---|
| `authorized` | `'true'` if the actor is authorized to run the workflow, otherwise `'false'`. |

**Inputs**

| Name | Required | Default | Description |
|---|---|---|---|
| `debug-mode` | No | `false` | Enable debug logging in the authorize action. |

**Usage**

```yaml
jobs:
  authorize:
    uses: Now-Micro/actions/.github/workflows/reusable-authorize.yml@v1
    with:
      debug-mode: "false"

  deploy:
    needs: authorize
    if: needs.authorize.outputs.authorized == 'true'
    runs-on: ubuntu-22.04
    steps:
      - run: echo "Authorized — proceeding with deployment"
```

---

### `nuget-publish.yml` — Reusable NuGet Package

Builds, packs, and publishes a versioned NuGet package from a release branch, then creates a GitHub release with the generated artifacts. Intended to run automatically when a `release/**` branch is pushed, or to be called explicitly from another workflow.

**What it does:**

1. Checks out the repository.
2. Validates the release ref and extracts the package name and version from it.
3. Finds the matching `.csproj` file.
4. Extracts the changelog entry for the release version.
5. Builds and packs the project, running tests if a test directory is specified.
6. Uploads artifacts and creates a GitHub release with release notes.

**Trigger:** Runs automatically on `push` to any `release/**` branch, or on `workflow_call`.

**Inputs**

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

**Secrets**

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | Yes | PAT with `read:packages` and `write:packages` permissions for pushing to GitHub Packages. |

**Usage — called from another workflow**

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

**Usage — automatic trigger on release branch push**

Simply push or merge to a branch named `release/MyLibrary/1.2.3`. The workflow will pick up the package name (`MyLibrary`) and version (`1.2.3`) from the branch name automatically.

```bash
git checkout -b release/MyLibrary/1.2.3
git push origin release/MyLibrary/1.2.3
```

---

### `reusable-pre-release.yml` — Reusable Pre-Release NuGet Package

Detects which project directories have changed and publishes a timestamped pre-release NuGet package for each one. Designed to be called on pull requests or feature branches to publish an `alpha`/`beta`/`rc`/`preview` build that consumers can test before a full release.

**What it does:**

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

**Inputs**

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

**Secrets**

| Name | Required | Description |
|---|---|---|
| `token-github-packages` | Yes | PAT with `read:packages` and `write:packages` permissions. |

**Usage — auto-detect changed packages on a PR**

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

**Usage — publish a specific directory**

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

**Version format**

Pre-release versions follow the pattern:

```
{base-version}-{identifier}-{YYYYMMDDHHmm}
```

For example, if the `.csproj` contains `<VersionPrefix>1.2.3</VersionPrefix>` and `version-increment-type` is `patch`, the published version will be something like:

```
1.2.4-alpha-202506011430
```
