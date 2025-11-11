<#
Clean up Git branches script

Description:
  Deletes local Git branches while preserving `main`, the currently checked-out branch, and any branches
  you explicitly ignore. The script prompts before deleting each branch and supports an interactive dry-run mode.

Parameters:
  -ExcludedBranches / --ignore <pattern>
	 One or more branch names or regular-expression patterns to protect from deletion. Pass the parameter
	 multiple times or supply a comma-separated list (PowerShell syntax). Patterns are treated as
	 case-insensitive regular expressions evaluated against the full branch name, so literals match a
	 single branch while something like '^chore/' covers groups of branches.

  -DryRun / --dry-run / -WhatIf
	 Preview which branches would be deleted without making any changes. CLI callers can use
	 '--dry-run=true' or '--dry-run=false'.

  Additional arguments:
	 Any argument other than the ones documented above causes the script to exit with an error to
	 prevent accidental misuse.

Basic usage examples:
  1. Interactive cleanup (prompts for every branch):
	  powershell.exe -File .\src\scripts\clean-up-git-branches.ps1

  2. Ignore specific branches:
	  powershell.exe -File .\src\scripts\clean-up-git-branches.ps1 -ExcludedBranches 'release','develop'

  3. Regex ignore (skip every branch starting with 'chore/'):
	  powershell.exe -File .\src\scripts\clean-up-git-branches.ps1 --ignore '^chore/'

  4. Dry run preview:
	  powershell.exe -File .\src\scripts\clean-up-git-branches.ps1 -DryRun

  5. Combine dry run with ignores using CLI flags:
	  powershell.exe -File .\src\scripts\clean-up-git-branches.ps1 --dry-run --ignore '^feature/'
#>
[CmdletBinding(PositionalBinding = $false)]
param(
	[Alias('ignore')]
	[string[]]$ExcludedBranches = @(),

	[Alias('dry-run', 'whatif')]
	[switch]$DryRun,

	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$AdditionalArguments
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-IgnoreList {
	param(
		[string[]]$ExplicitIgnore,
		[string[]]$Args,
		[ref]$DryRunFlag
	)

	$resolved = [System.Collections.Generic.List[string]]::new()

	foreach ($item in $ExplicitIgnore) {
		if (-not [string]::IsNullOrWhiteSpace($item)) {
			$resolved.Add($item.Trim()) | Out-Null
		}
	}

	if ($Args) {
		for ($i = 0; $i -lt $Args.Length; $i++) {
			$token = $Args[$i]
			if ([string]::IsNullOrWhiteSpace($token)) {
				continue
			}

			switch -Regex ($token) {
				'^--ignore$' {
					if ($i + 1 -ge $Args.Length) {
						throw "Missing value for --ignore."
					}
					$i++
					$resolved.Add($Args[$i].Trim()) | Out-Null
					continue
				}
				'^--ignore=(.+)$' {
					$resolved.Add(($Matches[1]).Trim()) | Out-Null
					continue
				}
				'^--dry-run$' {
					if ($DryRunFlag) {
						$DryRunFlag.Value = $true
					}
					continue
				}
				'^--dry-run=(.+)$' {
					if (-not $DryRunFlag) {
						throw "--dry-run cannot be assigned a value in this context."
					}
					$value = ($Matches[1]).Trim()
					switch -Regex ($value.ToLowerInvariant()) {
						'^(true|1|yes|on)$' { $DryRunFlag.Value = $true; continue }
						'^(false|0|no|off)$' { $DryRunFlag.Value = $false; continue }
						default { throw "Unsupported value for --dry-run: '$value'. Use true/false." }
					}
				}
				default {
					throw "Unknown argument '$token'. Supported options: --ignore <branch>, --dry-run."
				}
			}
		}
	}

	return $resolved.ToArray()
}

function Confirm-BranchDeletion {
	param(
		[Parameter(Mandatory = $true)]
		[string]$BranchName
	)

	while ($true) {
		$response = Read-Host "Delete local branch '$BranchName'? (y/N)"
		if ([string]::IsNullOrWhiteSpace($response)) {
			return $false
		}

		$normalized = $response.Trim().ToLowerInvariant()
		if ($normalized -in @('y', 'yes')) {
			return $true
		}
		if ($normalized -in @('n', 'no')) {
			return $false
		}

		Write-Host "Please respond with 'y' or 'n'."
	}
}

function Convert-ToStringLines {
	param(
		$Value
	)

	if ($null -eq $Value) {
		return @()
	}

	$lines = [System.Collections.Generic.List[string]]::new()
	foreach ($item in @($Value)) {
		if ($null -eq $item) { continue }
		if ($item -is [System.Management.Automation.ErrorRecord]) {
			$lines.Add($item.ToString()) | Out-Null
			continue
		}
		$lines.Add(($item.ToString())) | Out-Null
	}

	return $lines
}

try {
	Get-Command git -ErrorAction Stop | Out-Null
}
catch {
	throw "Git is not available on the PATH. Install Git before running this script."
}

$insideRepo = & git rev-parse --is-inside-work-tree 2>$null
if ($LASTEXITCODE -ne 0 -or -not $insideRepo -or $insideRepo.Trim().ToLowerInvariant() -ne 'true') {
	throw "This script must be run from within a Git repository."
}

$currentBranchOutput = & git rev-parse --abbrev-ref HEAD 2>&1
if ($LASTEXITCODE -ne 0) {
	throw "Unable to determine the current branch.`n$currentBranchOutput"
}

$currentBranch = $currentBranchOutput.Trim()
if ([string]::IsNullOrWhiteSpace($currentBranch)) {
	throw "Unable to determine the current branch."
}

$branchListOutput = & git for-each-ref --format="%(refname:short)" refs/heads/ 2>&1
if ($LASTEXITCODE -ne 0) {
	throw "Unable to list local branches.`n$branchListOutput"
}

$localBranches = $branchListOutput -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if (-not $localBranches) {
	Write-Host "No local branches found."
	return
}

$dryRunEnabled = [bool]$DryRun
$ignoreList = Resolve-IgnoreList -ExplicitIgnore $ExcludedBranches -Args $AdditionalArguments -DryRunFlag ([ref]$dryRunEnabled)
$baseProtected = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($branch in @('main', $currentBranch)) {
	if (-not [string]::IsNullOrWhiteSpace($branch)) {
		$baseProtected.Add($branch.Trim()) | Out-Null
	}
}

$ignorePatternTexts = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$ignoreRegexes = [System.Collections.Generic.List[System.Text.RegularExpressions.Regex]]::new()

foreach ($pattern in $ignoreList) {
	if ([string]::IsNullOrWhiteSpace($pattern)) {
		continue
	}
	$trimmedPattern = $pattern.Trim()
	$baseProtected.Add($trimmedPattern) | Out-Null
	$ignorePatternTexts.Add($trimmedPattern) | Out-Null
	try {
		$ignoreRegexes.Add([System.Text.RegularExpressions.Regex]::new($trimmedPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) | Out-Null
	}
 catch {
		$reason = $_.Exception.Message
		throw "Invalid regex pattern for ignore value '$trimmedPattern': $reason"
	}
}

$protectedBranchNames = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($name in $baseProtected) {
	if (-not [string]::IsNullOrWhiteSpace($name)) {
		$protectedBranchNames.Add($name.Trim()) | Out-Null
	}
}

foreach ($branchName in $localBranches) {
	$shouldProtect = $baseProtected.Contains($branchName)
	if (-not $shouldProtect -and (@($ignoreRegexes).Count -gt 0)) {
		foreach ($regex in $ignoreRegexes) {
			if ($regex.IsMatch($branchName)) {
				$shouldProtect = $true
				break
			}
		}
	}
	if ($shouldProtect) {
		$protectedBranchNames.Add($branchName) | Out-Null
	}
}

$candidates = $localBranches | Where-Object { -not $protectedBranchNames.Contains($_) }
if (-not $candidates) {
	Write-Host "There are no branches eligible for deletion."
	$protectedList = @($protectedBranchNames) | Sort-Object
	if ((@($protectedList).Count -gt 0)) {
		Write-Host "Protected branches: $([string]::Join(', ', $protectedList))"
	}
 else {
		Write-Host "Protected branches: (none)"
	}
	if ((@($ignorePatternTexts).Count -gt 0)) {
		$patternList = @($ignorePatternTexts) | Sort-Object
		Write-Host "Ignore patterns: $([string]::Join(', ', $patternList))"
	}
	return
}

Write-Host "Current branch: $currentBranch"
$protectedDisplay = @($protectedBranchNames) | Sort-Object
if ((@($protectedDisplay).Count -gt 0)) {
	Write-Host "Protected branches: $([string]::Join(', ', $protectedDisplay))"
}
else {
	Write-Host "Protected branches: (none)"
}
if ((@($ignorePatternTexts).Count -gt 0)) {
	$patternDisplay = @($ignorePatternTexts) | Sort-Object
	Write-Host "Ignore patterns: $([string]::Join(', ', $patternDisplay))"
}
if ($dryRunEnabled) {
	Write-Host "Dry run mode is ON. No branches will be deleted."
}
Write-Host "Branches that can be deleted:"
foreach ($branch in $candidates) {
	Write-Host "  - $branch"
}

$deleted = [System.Collections.Generic.List[string]]::new()
$simulated = [System.Collections.Generic.List[string]]::new()
$skipped = [System.Collections.Generic.List[string]]::new()

foreach ($branch in $candidates) {
	Write-Host ""
	Write-Host "Processing branch '$branch'..."
	if (-not (Confirm-BranchDeletion -BranchName $branch)) {
		Write-Host "Skipped '$branch'."
		$skipped.Add($branch) | Out-Null
		continue
	}

	if ($dryRunEnabled) {
		Write-Host "Dry run: would delete '$branch'."
		$simulated.Add($branch) | Out-Null
		continue
	}

	$originalErrorActionPreference = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	try {
		$output = git branch -d -- $branch 2>&1
		$exitCode = $LASTEXITCODE
	}
 finally {
		$ErrorActionPreference = $originalErrorActionPreference
	}
	$outputLines = Convert-ToStringLines $output

	if ($exitCode -eq 0) {
		foreach ($line in $outputLines) {
			$trimmed = $line.Trim()
			if ($trimmed) {
				Write-Host $trimmed
			}
		}
		Write-Host "Deleted '$branch'."
		$deleted.Add($branch) | Out-Null
		continue
	}

	Write-Warning "Failed to delete '$branch' (exit code $exitCode)."
	foreach ($line in $outputLines) {
		$trimmed = $line.Trim()
		if ($trimmed) {
			Write-Warning $trimmed
		}
	}
	$skipped.Add($branch) | Out-Null
}

Write-Host ""
Write-Host "Summary"
Write-Host "======="
Write-Host "Deleted branches ($(@($deleted).Count)):"
if ((@($deleted).Count -gt 0)) {
	foreach ($branch in $deleted) {
		Write-Host "  - $branch"
	}
}
else {
	Write-Host "  (none)"
}

if ($dryRunEnabled) {
	Write-Host "Branches that would be deleted ($(@($simulated).Count)):"
	if ((@($simulated).Count -gt 0)) {
		foreach ($branch in $simulated) {
			Write-Host "  - $branch"
		}
	}
 else {
		Write-Host "  (none)"
	}
}

Write-Host "Skipped branches ($(@($skipped).Count)):"
if ((@($skipped).Count -gt 0)) {
	foreach ($branch in $skipped) {
		Write-Host "  - $branch"
	}
}
else {
	Write-Host "  (none)"
}

Write-Host "Protected branches ($(@($protectedBranchNames).Count)):"
foreach ($branch in $protectedBranchNames | Sort-Object) {
	Write-Host "  - $branch"
}

Write-Host ""
if ($dryRunEnabled) {
	Write-Host "Dry run complete. No branches were deleted."
}
else {
	Write-Host "Completed branch clean-up."
}