# get-unique-project-directories

Returns unique parent project directories (nearest matching project file, e.g. `.csproj` or `package.json`) from a list of input paths.

For each path:

- it first checks whether the path matches `pattern`
- if matched, it walks up the tree to find the nearest file matching `project-file-name` (defaults to `.csproj`)
- if found, it returns that project file's directory
- if not found, it can optionally use `fallback-regex`
- it can optionally transform output values with `transformer`
- it can optionally fall back to original values when transformed directories do not exist (`use-original-if-missing`)

Values are de-duplicated in final output.

## Inputs

- `pattern` (required)  
   Regex used to decide which input paths are considered. The root directory must be captured in group 1 because the action uses `match[1]` when collecting results.

- `paths` (required)  
   Comma-separated file path list to evaluate.

- `project-file-name` (optional, default: `.csproj`)  
   File name (or suffix) that identifies a project's root directory, matched case-insensitively via `endsWith`. Leading and trailing whitespace is trimmed, whitespace-only values default to `.csproj`, and values containing `/` or `\\` are rejected. Set to an exact file name such as `package.json` to locate Node.js project directories instead.

- `output-is-json` (optional, default: `true`)  
  - `true`: output is JSON array string  
  - `false`: output is comma-separated string

- `debug-mode` (optional, default: `false`)  
   Enables debug logging.

- `fallback-regex` (optional, default: empty)  
   Applied only when no matching project file is found for a matched path.  
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
   # Match changed files under src or a top-level test directory and capture the project root.
   pattern: '^(src/[^/]+)/'
   # Comma-separated source/test paths to resolve to project directories.
   paths: 'src/App/Program.cs,tests/App.Tests/Unit/Test1.cs'
   # Serialize the unique directories as a JSON array.
   output-is-json: 'true'
```

### 2) Fallback when no `.csproj` exists

```yaml
with:
   # Select solution files as candidates for project-directory resolution.
   pattern: '.*\\.slnx$'
   # Path to the changed solution file.
   paths: 'src/demo/get-unique-project-directories/Trafera.Messaging.slnx'
   # Derive a fallback directory from the first path segment if no project file is found.
   fallback-regex: '^([^/]+)'
```

### 3) Transform `src` outputs to `tests`

```yaml
with:
   # Match source files whose output directory should be transformed.
   pattern: '^.*/src/.*\\.(cs|csproj|sln|slnx)$'
   # Source file to resolve before applying the transformer.
   paths: 'src/My.Library/File.cs'
   # Map the source project path to its corresponding tests project path.
   transformer: 's#^(.*?)/src/(.*)$#$1/tests/$2.Tests#'
```

### 4) Use transformed path only when it exists

```yaml
with:
   # Match source C# files for project-directory resolution.
   pattern: '^.*/src/.*\\.cs$'
   # Source file whose project path should be transformed.
   paths: 'src/My.Library/File.cs'
   # Map the source project path to its tests project path.
   transformer: 's#^(.*?)/src/(.*)$#$1/tests/$2.Tests#'
   # Keep the original project directory when the transformed directory is absent.
   use-original-if-missing: 'true'
```

### 5) CSV output

```yaml
with:
   # Match all C# files.
   pattern: '.*\\.cs$'
   # Multiple paths can be supplied as a comma-separated list.
   paths: 'src/App/File1.cs,src/App/File2.cs'
   # Return the unique directories as comma-separated text instead of JSON.
   output-is-json: 'false'
```

### 6) Find nearest Node.js project directory (`package.json`)

```yaml
with:
   # Match every supplied path so each one is checked for a nearby package.json.
   pattern: '.*'
   # Comma-separated directories or paths to inspect.
   paths: 'packages/app/src,packages/lib/test'
   # Use package.json to identify each Node.js project directory.
   project-file-name: 'package.json'
```
