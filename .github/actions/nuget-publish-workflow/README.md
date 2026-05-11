# NuGet Publish Workflow

This internal composite action wraps the shared NuGet publish workflow used by the demo and release automation.

## Usage

```yaml
- name: Run NuGet publish workflow
  uses: ./.github/actions/nuget-publish-workflow
  with:
    package: Api
    directory: src/demo/dotnet/src/Api
    github-token: ${{ secrets.GITHUB_TOKEN }}
```