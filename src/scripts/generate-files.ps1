$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourceDir = Join-Path $root "demo\fusion\Reviews"
$gatewayDir = $sourceDir
$projectPath = Join-Path $sourceDir "Demo.Reviews.csproj"

dotnet tool restore
& "$PSScriptRoot\export-schema.ps1" `
    -SubgraphName "Reviews" `
    -Url "http://localhost:59092/graphql" `
    -SrcDir $sourceDir `
    -OutputDir $gatewayDir `
    -ProjectPath $projectPath