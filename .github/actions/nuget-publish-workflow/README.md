# NuGet Publish Workflow

This internal composite action wraps the shared NuGet publish workflow used by the demo and release automation.

## Usage

```yaml
- name: Run NuGet publish workflow
  uses: ./.github/actions/nuget-publish-workflow
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    nuget-urls: https://nuget.pkg.github.com/Now-Micro/index.json
    package-directory: nupkgs
    package: Api
    ref-name: release/Api/1.0.0
    release-dotnet-version: 8.0.x, 10.0.x
    tests-directory: src/demo/dotnet/tests/Api.Tests
    token-github-packages: ${{ secrets.GITHUB_TOKEN }}
```
