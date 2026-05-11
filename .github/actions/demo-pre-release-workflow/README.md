# Demo Pre-Release Workflow

This demo action exercises the reusable pre-release workflow by publishing the demo API package and optionally deleting the published package version afterward.

## Usage

```yaml
- name: Run pre-release demo
  uses: ./.github/actions/demo-pre-release-workflow
  with:
    token-github-packages: ${{ secrets.GITHUB_TOKEN }}
    directory: src/demo/dotnet/src/Api
    prerelease-identifier: preview
```