# Requirements: Reusable npm Publish Workflow

**Acceptance Criteria:**

- [ X ] There is a reusable workflow that can publish npm packages from any GitHub workflow.
- [ X ] The reusable workflow supports publishing to GitHub Packages with scoped package names and configurable registry settings.
- [ X ] There is a demo workflow in this repository that exercises the reusable npm publish workflow end to end.
- [ X ] There is an easy-to-understand README.md that explains inputs, outputs, auth requirements, and how to use the reusable workflow safely.
- [ X ] The workflow only publishes from trusted refs such as `main` or release tags, not from pull requests or untrusted branches.

## Non-Functional Requirements

- **Performance:** N/A
- **Availability:** N/A
- **Security:** Use least-privilege credentials for publishing, keep tokens in GitHub secrets, avoid printing secrets to logs, and do not publish from untrusted events.
- **Accessibility:** N/A
- **Scalability:** N/A
