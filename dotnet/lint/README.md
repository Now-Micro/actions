# Dotnet Lint

This action verifies the CSharpier configuration and then runs the .NET formatting checks for the current repository.

## Usage

```yaml
- name: Run lint checks
  uses: ./dotnet/lint
  with:
    csharpierrc-path: ./.config/csharpierrc.yaml
    tools-json-path: ./.config/dotnet-tools.json
```