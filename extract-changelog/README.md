# Extract Changelog

This action finds a changelog file for a library, extracts the section for a specific version, and can upload the extracted content as an artifact.

## Usage

```yaml
- name: Extract release notes
  uses: ./extract-changelog
  with:
    library-name: My.Library
    version: 1.2.3
    library-directory: src/My.Library
    changelog-content-path: ./release-notes
```