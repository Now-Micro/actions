# Setup Node.js Environment

This action installs the requested Node.js version, optionally enables package-manager caching, and can run a lockfile-aware dependency install for npm, pnpm, or yarn.

## Usage

```yaml
- name: Set up Node.js
  uses: ./setup-node
  with:
    node-version: 24.x
    registry-url: https://npm.pkg.github.com
    scope: '@now-micro'
    cache: true
    cache-dependency-path: package-lock.json
    package-manager: npm
    install-dependencies: true
    install-dependencies-directory: src/demo/npm
    token-github-packages: ${{ secrets.GITHUB_TOKEN }}
```

  `package-manager` defaults to `npm`. Set it to `pnpm` or `yarn` to enable that package manager and use its lockfile-aware install command. When using `pnpm` or `yarn`, make sure `cache-dependency-path` points to `pnpm-lock.yaml` or `yarn.lock` respectively. The `cache` input uses the selected package manager's cache.
