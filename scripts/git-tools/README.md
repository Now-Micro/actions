# Git Tools

This folder contains small Git utilities. Currently included:

- `git-delete-local-branches.ps1` — Delete all local branches except `main` and any you choose to ignore.

## git-delete-local-branches.ps1

Delete local branches safely with a preview mode, while protecting `main`, your current branch, and any branches you specify.

### Features
- Protects `main` and the current branch automatically
- `-Ignore` accepts comma-separated names and wildcards (e.g. `release/*`, `hotfix-*`)
- `-WhatIf` preview via PowerShell ShouldProcess
- `-DryRun` convenience switch that enables `-WhatIf`
- Requires a clean working tree unless `-Force` is provided

### Requirements
- Windows PowerShell 5.1 or PowerShell 7+
- `git` on PATH
- Run inside a git repository

### Usage
From the repo root on Windows:

```powershell
# Preview (no deletions)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-tools\git-delete-local-branches.ps1 -WhatIf

# Ignore common branches and preview
y .\scripts\git-tools\git-delete-local-branches.ps1 -Ignore "develop,release/*,hotfix-*" -WhatIf

# Force actual deletion even if your working tree is dirty (use with care)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-tools\git-delete-local-branches.ps1 -Ignore "develop,release/*" -Force
```

### Examples
- Keep `develop` and any `release/*` or `hotfix-*` branches, delete the rest:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-tools\git-delete-local-branches.ps1 -Ignore "develop,release/*,hotfix-*"
```

### Safety
- The script never deletes `main` or your current branch.
- A clean working tree is required unless `-Force` is used.
- Use `-WhatIf` or `-DryRun` to see exactly what would be deleted before running for real.

### Notes
- Wildcards `*` and `?` are supported within `-Ignore`.
- If you need a cross‑platform bash version, open an issue or ask and we’ll add one.
