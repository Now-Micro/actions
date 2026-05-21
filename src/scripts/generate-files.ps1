$root = Join-Path $PSScriptRoot ".."
$gatewayDir = Join-Path $root "demo\fusion\Reviews"

dotnet tool restore
& "$PSScriptRoot\export-schema.ps1" `
    -SubgraphName "Reviews" `
    -Url "http://localhost:59092/graphql" `
    -SrcDir "$root\demo\fusion\Reviews\" `
    -OutputDir $gatewayDir `
    -ProjectPath "$root\demo\fusion\Reviews\Demo.Reviews.csproj"