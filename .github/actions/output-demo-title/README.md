# Output Demo Title

This action prints a standardized banner for demo sections so workflow output is easier to scan.

## Usage

```yaml
- name: Print demo title
  uses: ./.github/actions/output-demo-title
  with:
    title: Generate Version Demo
    path: ./.github/actions/demo-generate-version
```