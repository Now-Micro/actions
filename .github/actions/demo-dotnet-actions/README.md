# Demo .NET Actions

This demo action runs the repository's .NET-related composite actions in one place so the demo workflow can validate them together.

## Usage

```yaml
- name: Run .NET action demos
  uses: ./.github/actions/demo-dotnet-actions
```