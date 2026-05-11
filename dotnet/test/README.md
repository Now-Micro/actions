# Run Tests

This action finds a .NET project or solution when needed, installs the requested SDK, and runs `dotnet test`.

## Usage

```yaml
- name: Run tests
  uses: ./dotnet/test
  with:
    directory: src/MyApp.Tests
    dotnet-version: 8.0.x
```