# Setup Node.js Environment

This action installs the requested Node.js version, optionally enables npm caching, and can run `npm ci` for you.

## Usage

```yaml
- name: Set up Node.js
  uses: ./setup-node
  with:
    node-version: 24.x
    cache: true
    cache-dependency-path: package-lock.json
    install-dependencies: true
```