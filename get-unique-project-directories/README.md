# get-unique-project-directories

Returns unique parent project directories (nearest `.csproj` directory) from a list of input paths.

For each path:

- it first checks whether the path matches `pattern`
- if matched, it walks up the tree to find the nearest `.csproj`
- if found, it returns that `.csproj` directory
- if not found, it can optionally use `fallback-regex`
- it can optionally transform output values with `transformer`
- it can optionally fall back to original values when transformed directories do not exist (`use-original-if-missing`)

Values are de-duplicated in final output.

## Inputs

- `pattern` (required)  
   Regex used to decide which input paths are considered.

- `paths` (required)  
   Comma-separated file path list to evaluate.

- `output-is-json` (optional, default: `true`)  
  - `true`: output is JSON array string  
  - `false`: output is comma-separated string

- `debug-mode` (optional, default: `false`)  
   Enables debug logging.

- `fallback-regex` (optional, default: empty)  
   Applied only when no `.csproj` is found for a matched path.  
   If regex matches, capture group 1 is used; otherwise full match is used.

- `transformer` (optional, default: empty)  
   Applied to each resolved output path. Supports:
  - sed-style replacement: `s#pattern#replacement#flags`
  - regex extraction: first capture group (or full match)

- `use-original-if-missing` (optional, default: `false`)  
   Used with `transformer`. If transformed directory does not exist, use original non-transformed directory instead.

## Output

- `unique_project_directories`  
   Unique list of resolved directories (JSON string or CSV depending on `output-is-json`).

## Common use cases

### 1) Basic nearest project directory lookup

```yaml
with:
   pattern: '.*\\.cs$'
   paths: 'src/App/Program.cs,tests/App.Tests/Unit/Test1.cs'
   output-is-json: 'true'
```

### 2) Fallback when no `.csproj` exists

```yaml
with:
   pattern: '.*\\.slnx$'
   paths: 'src/demo/get-unique-project-directories/Trafera.Messaging.slnx'
   fallback-regex: '^([^/]+)'
```

### 3) Transform `src` outputs to `tests`

```yaml
with:
   pattern: '^.*/src/.*\\.(cs|csproj|sln|slnx)$'
   paths: 'src/My.Library/File.cs'
   transformer: 's#^(.*?)/src/(.*)$#$1/tests/$2.Tests#'
```

### 4) Use transformed path only when it exists

```yaml
with:
   pattern: '^.*/src/.*\\.cs$'
   paths: 'src/My.Library/File.cs'
   transformer: 's#^(.*?)/src/(.*)$#$1/tests/$2.Tests#'
   use-original-if-missing: 'true'
```

### 5) CSV output

```yaml
with:
   pattern: '.*\\.cs$'
   paths: 'src/App/File1.cs,src/App/File2.cs'
   output-is-json: 'false'
```
