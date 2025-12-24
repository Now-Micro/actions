# Find Files Action

Find files within a working directory using either a regular expression or a literal file name. Outputs matched files and the directories containing them (arrays align by index).

## Inputs

- `regex` (required): Regex pattern or plain filename to match against file names. Plain names are treated literally.
- `working-directory` (optional): Directory to search. Defaults to the repository root.
- `debug-mode` (optional): Set to `true` for verbose logging.

## Outputs

- `matched-files`: JSON array of matched file paths relative to the working directory.
- `matched-dirs-relative`: JSON array of directories (relative) containing each matched file. Indexes correspond to `matched-files`.
- `matched-dirs-absolute`: JSON array of absolute directories containing each matched file. Indexes correspond to `matched-files`.

## Usage

```yaml
- name: Find log files
  uses: ./find
  with:
    regex: "\\.log$"
    working-directory: "src"
```

```yaml
- name: Find exact file
  uses: ./find
  with:
    regex: "README.md"
```
