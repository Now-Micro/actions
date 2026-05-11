# Get Unique Root Directories

This action finds unique root directories from a list of changed file paths using a regex pattern and optional debug logging.

## Usage

```yaml
- name: Get unique root directories
  uses: ./get-unique-root-directories
  with:
    pattern: '^src/'
    paths: 'src/App/File1.cs,src/Lib/File2.cs'
    output-is-json: true
```