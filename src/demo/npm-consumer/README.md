# npm Consumer Demo

This tiny project installs the published `@now-micro/demo-npm` package and verifies that all exported functions are present and behave as expected.

## What it proves

- The package can be installed from the registry.
- The published entry point exposes every expected export.
- The exported functions return the expected results.

## Run it

```bash
cd src/demo/npm-consumer
npm run check
```

If your environment needs GitHub Packages authentication, the script will prompt for a token when `NODE_AUTH_TOKEN` or `NPM_TOKEN` is not already set.