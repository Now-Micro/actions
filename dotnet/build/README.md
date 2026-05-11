# Build Solution

This action builds a .NET solution or project and can also package or publish it, with optional Node.js frontend support and NuGet source configuration.

## Usage

```yaml
- name: Build and publish
  uses: ./dotnet/build
  with:
    file-to-build: src/MyApp/MyApp.sln
    dotnet-version: 8.0.x
    build-configuration: Release
    mode: publish
```