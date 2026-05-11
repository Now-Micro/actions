# Demo Validate Release

This demo action exercises the NuGet release validation helper with representative package, version, and ref-name inputs.

## Usage

```yaml
- name: Run release validation demo
  uses: ./.github/actions/demo-validate-release
  with:
    package: Demo.Library
    version: 1.2.3
    ref-name: release/Demo.Library/1.2.3
```