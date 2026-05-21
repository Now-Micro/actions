param(
    [string]$SubgraphName,
    [string]$Url,
    [string]$SrcDir,
    [string]$OutputDir,
    [string]$ProjectPath
)

$schemaPath = Join-Path $SrcDir "schema.graphql"
$configPath = Join-Path $SrcDir "subgraph-config.json"
$extensionsPath = Join-Path $SrcDir "schema.extensions.graphql"
$outputPath = Join-Path $OutputDir "$SubgraphName.fsp"

if ($ProjectPath) {
    dotnet run --project $ProjectPath -- schema export --output $schemaPath
}
[pscustomobject]@{
    subgraph = $SubgraphName
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $configPath -Encoding utf8

dotnet fusion subgraph config set http --url $Url -w $SrcDir

$packArguments = @(
    'subgraph', 'pack',
    '-s', $schemaPath,
    '-c', $configPath,
    '-p', $outputPath
)

if (Test-Path -LiteralPath $extensionsPath) {
    $packArguments += @('-e', $extensionsPath)
}

dotnet fusion @packArguments
