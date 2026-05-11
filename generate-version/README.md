# Generate Version

This action calculates a semantic version from a project file, with optional release keyword matching and timestamp or infix support.

## Usage

```yaml
- name: Generate version number
  uses: ./generate-version
  with:
    project-file: src/MyApp/MyApp.csproj
    increment-type: patch
    release-keyword: release
```