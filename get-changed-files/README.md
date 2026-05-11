# Get Changed Files

This action compares two refs and returns the changed file paths as a JSON array in the `changed_files` output.

## Usage

```yaml
- name: Get changed files
  uses: ./get-changed-files
  with:
    base-ref: main
    head-ref: feature/my-change
```