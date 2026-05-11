# Docker Clean Up

This action removes old Docker containers, images, volumes, and networks whose names match a prefix. It supports dry-run mode and output counts for the resources it removes.

## Usage

```yaml
- name: Clean Docker resources
  uses: ./docker/clean-up
  with:
    prefix: my-app-
    keep-count: 2
    dry-run: false
```