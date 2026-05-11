# Validate NuGet Release Configuration

This action parses a release package name and version from workflow inputs or from the current ref name.

## Usage

```yaml
- name: Validate release inputs
  uses: ./nuget/release/validation
  with:
    package: My.Library
    version: 1.2.3
    ref-name: release/My.Library-1.2.3
```