# GitHub Summary - Pre-Release

This action writes a GitHub step summary for a pre-release NuGet publish run, including the detected artifacts and the base ref that was compared.

## Usage

```yaml
- name: Summarize pre-release publish
  uses: ./github/summary/pre-release
  with:
    base-ref: main
    prerelease-identifier: preview
    artifacts-dir: prerelease-artifacts
    changed-dirs: '["src/My.Library"]'
```