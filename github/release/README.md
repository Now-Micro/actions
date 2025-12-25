# GitHub Release Action

Composite action that prepares release assets, builds release notes, and (optionally) tags and publishes a GitHub Release. It is designed for reusable workflows across repositories.

## Inputs

- `artifact-name` (optional): Specific artifact name to download.
- `artifacts-path` (default `release-artifacts`): Directory containing downloaded artifacts.
- `body-filename` (default `RELEASE_NOTES.md`): Filename for generated notes.
- `changelog-path` (optional): Path to changelog content to append to notes.
- `dry-run` (default `false`): When true, skips tag creation and GitHub Release publication.
- `library-name` (required): Library/package name for tagging and notes.
- `packages-path` (default `release-packages`): Directory to copy package assets into.
- `release-name-template` (default `{library-name} v{release-version}`): Template for release display name.
- `release-version` (required): Version used in tag and release name.
- `skip-download` (default `false`): When true, does not call `actions/download-artifact`.
- `tag-prefix` (default `<library-name>-v`): Prefix concatenated with version to form the tag.

## Outputs

- `tag-name`: Computed tag (prefix + version).
- `release-name`: Rendered release name.
- `release-notes-path`: Absolute path to generated notes.
- `has-packages`: Count of copied packages.
- `packages-json`: JSON array of copied package filenames.

## Behavior

- Copies `.nupkg`, `.snupkg`, and `.symbols.nupkg` files from `artifacts-path` into `packages-path`.
- Generates release notes listing copied packages and optionally appends changelog content (or a placeholder if missing).
- When `dry-run` is `false` and packages exist, creates a git tag and GitHub release via `softprops/action-gh-release`.

## Example

```yaml
- name: GitHub Release
  uses: ./.github/actions/github-release
  with:
    library-name: Demo.Library
    release-version: 1.2.3
    artifact-name: build-artifacts
    changelog-path: release-artifacts/changelog.md
```
