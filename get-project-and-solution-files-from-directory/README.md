# Get Solution or Project File from Directory

This action searches a directory tree for the first matching `.sln` or `.csproj` file and returns the path and file name.

## Usage

```yaml
- name: Find a solution file
  uses: ./get-project-and-solution-files-from-directory
  with:
    directory: src
    find-solution: true
    find-project: true
    max-depth: 4
```