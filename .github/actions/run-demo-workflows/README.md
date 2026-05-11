# Run Demo Workflows

This action runs the full suite of demo composite actions used by the repository's demo workflow.

## Usage

```yaml
- name: Run demo workflows
  uses: ./.github/actions/run-demo-workflows
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    github-release-token: ${{ secrets.RELEASE_TOKEN }}
```