# get-parent-project

Resolves the closest `.csproj` for each provided file path that matches the supplied regex pattern, walking up parent directories and stopping at the first directory containing a `.csproj`. Paths that do not match the pattern return an empty string; matching paths with no `.csproj` found return the original path. The `output-is-json` input toggles between JSON array output and a comma-separated string.

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