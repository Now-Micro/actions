param(
    [string]$SubgraphName,
    [string]$Url,
    [string]$SrcDir,
    [string]$OutputDir,
    [string]$ProjectPath
)

function Write-Log {
    param([string]$Message)

    Write-Host "[export-schema] $Message"
}

Write-Log "Starting schema export."
Write-Log "SubgraphName: $SubgraphName"
Write-Log "Url: $Url"
Write-Log "SrcDir: $SrcDir"
Write-Log "OutputDir: $OutputDir"
if ($ProjectPath) {
    Write-Log "ProjectPath: $ProjectPath"
}
else {
    Write-Log "ProjectPath: (not provided)"
}

if ($ProjectPath) {
    Write-Log "Running schema export command."
    dotnet run --project $ProjectPath -- schema export --output "$SrcDir\schema.graphql"
}
Write-Log "Writing subgraph config to $SrcDir\subgraph-config.json"
"{`"subgraph`":`"$SubgraphName`"}" | Set-Content "$SrcDir\subgraph-config.json"
Write-Log "Configuring Fusion subgraph HTTP endpoint."
dotnet fusion subgraph config set http --url $Url -w $SrcDir
Write-Log "Packing Fusion subgraph artifact to $OutputDir\$SubgraphName.fsp"
dotnet fusion subgraph pack -s "$SrcDir\schema.graphql" -c "$SrcDir\subgraph-config.json" -e "$SrcDir\schema.extensions.graphql" -p "$OutputDir\$SubgraphName.fsp"
Write-Log "Schema export completed."
