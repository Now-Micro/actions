# nuget/publish

Deploys a NuGet package built from a .NET project to a destination:
- Local folder (for demos/testing) when `publish-source` is a path.
- GitHub Packages (default) when `publish-source` is omitted. Requires a GitHub token.

This composite orchestrates:
- Project resolution (either a provided project file or discovery from a directory and project-regex).
- Build/pack via `dotnet/build` (mode: pack).
- Package publication via `publish.js`.

## Key behavior
- You must provide either `project-file` or `directory`.
  - If both are provided, `project-file` is used.
  - If neither is provided, the action exits with an error.
- Packing should output `.nupkg` files to `nupkgs/` at the workspace root.
- If `publish-source` looks like a path (relative or absolute), packages are copied there.
- If `publish-source` is omitted, packages are pushed to GitHub Packages using the repository owner.
- A token is required only for remote pushes; local folder copies don’t require a token.

## Inputs
- additional-build-args (optional): Extra args for `dotnet build`.
- additional-pack-args (optional): Extra args for `dotnet pack` (use `--output nupkgs`).
- debug-mode (optional): Extra logs for discovery.
- directory (optional): Directory to search for a `.csproj`. Mutually exclusive with `project-file`.
- dotnet-version (optional): .NET SDK version (default `9.0.x`).
- github-token (required): Token for remote publish (GitHub Packages). Not used for local copies.
- nuget-names/nuget-usernames/nuget-passwords/nuget-urls (optional): NuGet source configuration passed to `dotnet/build`.
- project-file (optional): Full path to a `.csproj`. Mutually exclusive with `directory`.
- project-regex (optional): Used with `directory` to select a project.
- publish-source (optional): Target location; omit to default to GitHub Packages.
- run-tests (optional): Run `dotnet test` for the resolved project.

## Outputs
- None.

## Examples

Using a project file, publish to a local folder (for demo):

```yaml
- name: NuGet publish (project-file to local)
  uses: Now-Micro/actions/nuget/publish@v1
  with:
    project-file: demo/dotnet/src/Api/Api.csproj
    additional-pack-args: --output nupkgs /p:PackageVersion=1.0.0
    publish-source: .artifacts/nuget-local
    github-token: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

Discover from a directory and publish to GitHub Packages (default target):

```yaml
- name: NuGet publish (directory -> GitHub Packages)
  uses: Now-Micro/actions/nuget/publish@v1
  with:
    directory: demo/dotnet/src/Api
    project-regex: 'Api\.csproj$'
    additional-pack-args: --output nupkgs /p:PackageVersion=1.0.0
    github-token: ${{ secrets.TOKEN_GITHUB_PACKAGES }}
```

## Demos
See `.github/actions/demo-nuget-publish` and workflow `.github/workflows/demo-nuget-publish.yml` for end-to-end scenarios:
- Missing inputs validation (expect failure)
- Remote publish without token (expect failure)
- Local publish (success) using `directory`
- Local publish (success) using `project-file`

## Troubleshooting
- Error: "Either 'project-file' or 'directory' must be provided." — Provide one of these inputs.
- Error: "No .nupkg files found to publish" — Ensure pack outputs to `nupkgs/` (via `--output nupkgs`).
- Error: "INPUT_GITHUB_TOKEN is required to push to remote source" — Provide `github-token` when pushing to remote (GitHub Packages).
