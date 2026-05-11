# Install .NET SDKs

This action installs one or more .NET SDK versions and can place them in a custom install directory.

## Usage

```yaml
- name: Install .NET SDKs
  uses: ./dotnet/install
  with:
    dotnet-version: '8.0.x,9.0.x'
    dotnet-install-directory: ${{ runner.temp }}/.dotnet
```