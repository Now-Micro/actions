# Demo Generate Version

This demo action exercises the version generator against a sample project file and release-keyword flow.

## Usage

```yaml
- name: Run version demo
  uses: ./.github/actions/demo-generate-version
  with:
    infix: demo
```