# get-unique-parent-directories

This action takes a list of file paths and returns the unique parent project directories for each path based on a specified file pattern (e.g. `.*\.cs$`). It searches up the directory tree for each path to find the nearest parent project file (e.g. `.csproj`) that matches the pattern. If no parent project is found, nothing is returned for that path. Optionally, a fallback regex can be applied to extract a project name from the path when no parent project file is found, which can be useful for non-standard project structures.

```yaml
with:
   pattern: '.*\\.cs$'
   paths: |
      Messaging/Trafera.Messaging.Abstractions/src/SomeFile.cs,
      Messaging/Trafera.Messaging.Project2/tests/sub/another/SomeTestFile.cs,
      Messaging/Trafera.Messaging.Project3/README.md
   output-is-json: true
```

This returns the nearest `.csproj` for the `.cs` entries and echoes the unchanged `README.md` path because no `.csproj` exists above it.