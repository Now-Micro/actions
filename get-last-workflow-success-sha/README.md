# Get Last Workflow Success SHA

This action finds the SHA of the last successful run of a workflow on a branch by checking the required jobs.

## Usage

```yaml
- name: Find last successful SHA
  uses: ./get-last-workflow-success-sha
  with:
    branch: feature/my-branch
    workflow-name: checks.yml
    main-job-name: test
    job-names-that-must-succeed: build,test
```