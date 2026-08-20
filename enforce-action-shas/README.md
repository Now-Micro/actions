# Enforce Action SHAs

Scans GitHub workflow YAML files and fails the run if it finds a `uses:` reference that is not pinned to a full 40-character commit SHA. Useful as a guardrail so consumers of a repo can't accidentally (or intentionally) introduce a floating tag/branch reference for a third-party action.

## What it checks

- Recursively scans `scan-paths` (directories or individual YAML files) for `.yml`/`.yaml` files.
- For every `uses:` line found, extracts the reference after the last `@`.
- Flags the reference as a violation if:
  - There is no `@ref` at all (e.g. `uses: actions/checkout`), or
  - The ref after `@` is not a full 40-character commit SHA (e.g. `@v4`, `@main`).
- Skips local action/workflow references (`./...`, `../...`) and Docker references (`docker://...`) since these aren't pinned via commit SHA.
- Skips any action whose `owner/repo[/path]` portion matches `exclude-action-pattern`. Defaults to `^(Now-Micro|trafera-llc)/actions(/|$)`, excluding this repo when consumed under either org. Providing `exclude-action-pattern` **replaces** the default entirely rather than adding to it.

All violations are collected and reported together (file, line, reference, reason) before the action exits with code 1 — it doesn't stop at the first one found.

## Usage

```yaml
- name: Enforce action SHAs
  uses: Now-Micro/actions/enforce-action-shas@v1
  with:
    scan-paths: '.github/workflows'
    exclude-dirs: 'coverage,node_modules'
    exclude-action-pattern: '^(Now-Micro|trafera-llc)/'
    debug-mode: 'false'
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `scan-paths` | No | `.github/workflows` | Comma-separated list of directories (or individual YAML files) to recursively scan. |
| `exclude-dirs` | No | `''` | Comma-separated list of directory path fragments to exclude from scanning. |
| `exclude-action-pattern` | No | `^(Now-Micro\|trafera-llc)/actions(/\|$)` | Regex matched against `owner/repo[/path]`. Matching actions are allowed to float (no SHA check). Setting this input replaces the default rather than adding to it. |
| `debug-mode` | No | `false` | Enables verbose logging of every file and `uses:` reference scanned. |

## Outputs

| Name | Description |
| --- | --- |
| `violation-count` | Number of `uses:` references not pinned to a full commit SHA. |
| `violations` | JSON array of `{ file, line, uses, reason }` objects. |

## Notes

- `uses:` values driven by expressions (e.g. `${{ matrix.action }}`) can't be statically validated and will be reported as violations unless excluded via `exclude-action-pattern` or `exclude-dirs`.
- Outputs are written before the action exits, so `violation-count`/`violations` are available even on failure (e.g. for a follow-up step that posts a summary using `if: always()`).
