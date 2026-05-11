# Demo NuGet Publish

This demo action exercises the NuGet publish action across failure and success cases, including local-folder publishing.

## Usage

```yaml
- name: Run NuGet publish demo
  uses: ./.github/actions/demo-nuget-publish
  with:
    directory: src/demo/dotnet/src/Api
    github-token: ${{ secrets.GITHUB_TOKEN }}
```