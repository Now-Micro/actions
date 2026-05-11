# Get Changed Files

This action compares two refs and returns the changed directories as JSON.

## Usage

```yaml
- name: Get changed files
  uses: ./get-changed-files
  with:
    base-ref: main
    head-ref: feature/my-change
```