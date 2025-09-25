<#
.SYNOPSIS
  Delete all local git branches except 'main' and an optional ignore list.

.DESCRIPTION
  Removes local branches in the current git repository, excluding:
  - 'main' (always protected)
  - the currently checked-out branch
  - any branches matched by -Ignore (supports comma-separated names and wildcards)

  Safety features:
  - Requires a clean working directory unless -Force is specified
  - Supports -WhatIf and -Confirm via ShouldProcess
  - Shows a summary of branches to be deleted before proceeding

.PARAMETER Ignore
  Comma-separated list of branch names or wildcard patterns to skip. Example: "develop,release/*,hotfix-*".

.PARAMETER Force
  Proceed even if the working tree has uncommitted changes (not recommended).

.PARAMETER DryRun
  Alias for -WhatIf to preview deletions without executing.

.EXAMPLE
  ./scripts/git-tools/git-delete-local-branches.ps1

.EXAMPLE
  ./scripts/git-tools/git-delete-local-branches.ps1 -Ignore "develop,release/*,hotfix-*"

.EXAMPLE
  ./scripts/git-tools/git-delete-local-branches.ps1 -WhatIf

.NOTES
  Requires git to be installed and available on PATH. Run from within the repo.
#>

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Position = 0)]
    [string] $Ignore = "",

    [switch] $Force,

    [switch] $DryRun
)

function Write-Info($msg) { Write-Host "[git-prune] $msg" }
function Write-Warn($msg) { Write-Warning "[git-prune] $msg" }
function Exec($cmd, [switch]$NoTrim) {
    # Ensure temp files are created in the same directory as this script
    $scriptDir = $PSScriptRoot
    if (-not $scriptDir) { $scriptDir = Split-Path -Parent $PSCommandPath }
    $tmpOut = Join-Path $scriptDir 'temp_out.txt'
    $tmpErr = Join-Path $scriptDir 'temp_err.txt'

    $p = Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", $cmd -NoNewWindow -Wait -PassThru -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    $out = Get-Content $tmpOut -Raw -ErrorAction SilentlyContinue
    $err = Get-Content $tmpErr -Raw -ErrorAction SilentlyContinue
    if ($null -eq $out) { $out = "" }
    if ($null -eq $err) { $err = "" }
    Remove-Item -ErrorAction SilentlyContinue $tmpOut, $tmpErr
    if ($LASTEXITCODE -ne 0 -and $p.ExitCode -ne 0) {
        throw "Command failed ($cmd): $err $out"
    }
    if ($NoTrim) { return $out } else { return ($out -replace "\r", "") -replace "\n$", "" }
}

# Ensure we are inside a git repo
try {
    Exec "git rev-parse --is-inside-work-tree | Out-Null"
}
catch {
    Write-Error "Not inside a git repository."
    exit 1
}

# Resolve current branch
$current = Exec "git rev-parse --abbrev-ref HEAD"

# Check working tree clean unless forced
if (-not $Force) {
    $status = Exec "git status --porcelain" -NoTrim
    if ($null -eq $status) { $status = "" }
    if ($status.Trim().Length -gt 0) {
        Write-Warn "Working tree is not clean. Commit/stash or pass -Force to continue."
        exit 1
    }
}

# Build ignore set (always protect 'main' and current)
$ignoreList = @()
if ($Ignore) {
    $ignoreList += ($Ignore -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
}
$ignoreList += @("main", $current)
$ignoreList = $ignoreList | Select-Object -Unique

# Get local branches
$branchesRaw = Exec "git branch --format='%(refname:short)'" -NoTrim
$branches = @()
if ($branchesRaw) { $branches = $branchesRaw -split "\r?\n" | Where-Object { $_ -ne "" } }

# Helper: check if name matches any wildcard pattern in list
function MatchesAny($name, $patterns) {
    foreach ($pat in $patterns) {
        if ([string]::IsNullOrWhiteSpace($pat)) { continue }
        # Convert git-style wildcard to regex
        $regex = "^" + [Regex]::Escape($pat).Replace("\*", ".*").Replace("\?", ".") + "$"
        if ($name -match $regex) { return $true }
    }
    return $false
}

# Filter deletable branches
$toDelete = @()
foreach ($b in $branches) {
    if (MatchesAny $b $ignoreList) { continue }
    $toDelete += $b
}

if ($toDelete.Count -eq 0) {
    Write-Info "No branches to delete."
    exit 0
}

Write-Info "Current branch: $current"
Write-Info ("Protected: {0}" -f (($ignoreList | Where-Object { $_ -and $_.Trim() -ne '' }) -join ', '))
Write-Info "Will delete (local):" 
$toDelete | ForEach-Object { Write-Host "  - $_" }

# If DryRun is specified, enable WhatIf behavior
if ($DryRun) {
    $WhatIfPreference = $true
}

if ($PSCmdlet.ShouldProcess("local branches", "delete: " + ($toDelete -join ', '))) {
    foreach ($b in $toDelete) {
        try {
            Exec "git branch -D -- $b"
            Write-Info "Deleted $b"
        }
        catch {
            # Use explicit error variable to avoid interpolation issues
            $errMsg = $_ | Out-String
            Write-Warn ("Failed to delete {0}: {1}" -f $b, $errMsg.Trim())
        }
    }
}

if ($DryRun -and -not $WhatIf) {
    Write-Info "DryRun specified; no branches were deleted."
}
