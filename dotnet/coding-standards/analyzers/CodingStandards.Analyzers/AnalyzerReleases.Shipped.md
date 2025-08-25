; Shipped analyzer releases
; https://github.com/dotnet/roslyn-analyzers/blob/master/src/Microsoft.CodeAnalysis.Analyzers/ReleaseTrackingAnalyzers.Help.md

## Release 1.0

### New Rules

Rule ID | Category | Severity | Notes
--------|----------|----------|--------------------
DA0001  |  Usage   |  Error   | Avoid await inside loop
DA0002  |  Usage   |  Error   | Disallow string concatenation / string.Format (use interpolation)