# Setup Node.js Environment

This action installs the requested Node.js version, optionally enables npm caching, and can run a lockfile-aware npm install for you.

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
    install-dependencies: true
    install-dependencies-directory: src/demo/npm
    install-dependencies-mode: auto
    token-github-packages: ${{ secrets.GITHUB_TOKEN }}
```
