## Coding Standards

### Gotchas

If you see the following error when trying to use this action, you will need to use the `roslyn-version` input in order to get the custom analyzers to work:

```bash
CodingStandards.Analyzers -> /home/runner/work/actions/actions/demo/coding-standards-fail/CodingStandards.Analyzers/bin/Debug/netstandard2.0/CodingStandards.Analyzers.dll
CSC : warning CS9057: The analyzer assembly '/home/runner/work/actions/actions/demo/coding-standards-fail/CodingStandards.Analyzers/bin/Debug/netstandard2.0/CodingStandards.Analyzers.dll' references version '4.9.0.0' of the compiler, which is newer than the currently running version '4.8.0.0'. [/home/runner/work/actions/actions/demo/coding-standards-fail/src/Demo.Linting/Demo.Linting.csproj]
```

For the case above, the value needed for `roslyn-version` is `4.8.0`.