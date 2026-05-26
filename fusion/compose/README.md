# Compose Fusion Gateway

Restores Fusion subgraph artifacts from GitHub releases (optional) and composes them into a gateway `.fgp` file.

## Inputs

- `debug-mode` (optional, default `false`): Enables verbose logging.
- `dotnet-tools-manifest-path` (optional, default `.config/dotnet-tools.json`): Path to the local dotnet tools manifest.
- `gh-token` (optional, default empty): GitHub token used for `gh release download`.
- `input-directory` (optional, default `artifacts/subgraphs`): Directory recursively scanned for subgraph files.
- `manifest-path` (optional, default empty): Path to manifest JSON containing release assets. Used when `subgraph-artifacts-json` is empty.
- `subgraph-artifacts-json` (optional, default empty): Inline JSON manifest for restore details. When provided, this overrides `manifest-path`.
- `output-directory` (optional, default empty): Directory used for staged downloads. If empty, `manifest.outputDirectory` is used.
- `output-file` (required): Output path for composed gateway file.
- `run-dotnet-tool-restore` (optional, default `true`): Runs `dotnet tool restore` before compose.
- `subgraph-file-extension` (optional, default `.fsp`): Extension used when discovering subgraph files.
- `verify-fusion-command` (optional, default `true`): Runs `dotnet tool run fusion -- --help` before compose.
- `working-directory` (optional, default empty): Base directory for resolving relative paths. Defaults to current working directory.

## Outputs

- `input-directory`: Resolved absolute directory used for composition.
- `output-file`: Resolved absolute path of composed gateway output.
- `subgraph-count`: Number of subgraph files passed to Fusion compose.

## Manifest Shape

Provide either `manifest-path` or `subgraph-artifacts-json` using this JSON shape:

```json
{
  "outputDirectory": "artifacts/subgraphs",
  "subgraphs": [
    {
      "name": "accounts",
      "repository": "Now-Micro/accounts",
      "releaseTag": "v1.2.3",
      "assetName": "accounts-release.fsp"
    }
  ]
}
```

Each downloaded `assetName` is staged under `<outputDirectory>/<name>/` and copied to `<outputDirectory>/<name>/<name>.fsp` for stable composition inputs.

If both `manifest-path` and `subgraph-artifacts-json` are set, inline JSON takes precedence.

## Usage

```yaml
- name: Compose gateway
  uses: Now-Micro/actions/fusion/compose@v1
  with:
    gh-token: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
    manifest-path: gateway-release.json
    input-directory: artifacts/subgraphs
    output-file: src/Trafera.GraphQL.Gateway/gateway.fgp
```

```yaml
- name: Compose gateway with inline restore details
  uses: Now-Micro/actions/fusion/compose@v1
  with:
    gh-token: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
    subgraph-artifacts-json: |
      {
        "outputDirectory": "artifacts/subgraphs",
        "subgraphs": [
          {
            "name": "accounts",
            "repository": "Now-Micro/accounts",
            "releaseTag": "v1.2.3",
            "assetName": "accounts-release.fsp"
          }
        ]
      }
    input-directory: artifacts/subgraphs
    output-file: src/Trafera.GraphQL.Gateway/gateway.fgp
```
