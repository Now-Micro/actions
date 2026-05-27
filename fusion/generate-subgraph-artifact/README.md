# Generate Fusion Subgraph Artifact

Exports a Hot Chocolate schema, builds subgraph config, packs a `.fsp` artifact, and writes metadata JSON for release workflows.

## Inputs

- `artifact-version` (required): Version string written to metadata JSON.
- `commit-sha` (optional, default empty): Commit SHA written to metadata JSON. Falls back to `GITHUB_SHA` when empty.
- `debug-mode` (optional, default `false`): Enables verbose logging.
- `project-path` (optional, default empty): Path to the `.csproj` used for `dotnet run ... schema export`. If empty, `schema-dir/schema.graphql` must already exist.
- `schema-dir` (required): Directory used for `schema.graphql`, `subgraph-config.json`, and optional `schema.extensions.graphql`.
- `source-repo-url` (optional, default empty): Source repository URL written to metadata JSON.
- `subgraph-http-url` (required): HTTP URL written into subgraph config and used for Fusion config.
- `subgraph-name` (required): Subgraph name used in config and output file names.
- `working-directory` (optional, default empty): Base directory for resolving relative paths and dotnet command execution.

## Outputs

- `artifact-path`: Absolute path to the generated `.fsp` file.
- `metadata-path`: Absolute path to the generated metadata JSON file.
- `publish-dir`: Absolute path to the runner-safe directory containing generated artifact files.

## Behavior

1. Ensures the local `.config/dotnet-tools.json` includes `hotchocolate.fusion.commandline`.
2. Runs `dotnet tool restore`.
3. Exports `schema.graphql` when `project-path` is provided.
4. Writes `subgraph-config.json` with subgraph name and HTTP base address.
5. Runs `dotnet fusion subgraph config set http`.
6. Runs `dotnet fusion subgraph pack` and includes `-e schema.extensions.graphql` when that file exists.
7. Writes `<subgraph-name>.metadata.json` with:
   - `subgraphName`
   - `artifactVersion`
   - `commitSha`
   - `sourceRepoUrl`
   - `generationDateUtc`

## Usage

```yaml
- name: Generate subgraph artifact
  uses: Now-Micro/actions/fusion/generate-subgraph-artifact@v1
  with:
    artifact-version: 1.2.3
    commit-sha: ${{ github.sha }}
    source-repo-url: ${{ github.server_url }}/${{ github.repository }}
    project-path: src/MySubgraph/MySubgraph.csproj
    schema-dir: artifacts/schema
    subgraph-name: accounts
    subgraph-http-url: https://accounts.example.com/graphql
```

```yaml
- name: Generate subgraph artifact from pre-exported schema
  uses: Now-Micro/actions/fusion/generate-subgraph-artifact@v1
  with:
    artifact-version: 1.2.3
    schema-dir: src/Trafera.Reviews/schema
    subgraph-name: reviews
    subgraph-http-url: https://reviews.example.com/graphql
```

When `project-path` is omitted, make sure `schema-dir/schema.graphql` already exists before this action runs.

Artifacts are written to a runner-safe temp directory:

`<RUNNER_TEMP or os.tmpdir>/now-micro-fusion-subgraph-artifacts/<GITHUB_RUN_ID or local>`
