# Reusable Pre-Release Workflow

This internal composite action drives the shared pre-release NuGet publishing flow for the demo workflows.

## Usage

```yaml
- name: Run reusable pre-release workflow
  uses: ./.github/actions/reusable-pre-release-workflow
  with:
    directory: src/demo/dotnet/src/Api
    base-ref: main
    token-github-packages: ${{ secrets.GITHUB_TOKEN }}
```