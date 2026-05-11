# Configure NuGet Sources

This action configures one or more NuGet feeds with matching names, URLs, usernames, and personal access tokens.

## Usage

```yaml
- name: Configure NuGet sources
  uses: ./nuget/configure-sources
  with:
    names: github,internal
    urls: https://nuget.example.com/v3/index.json,https://pkgs.example.com/v3/index.json
    usernames: user1,user2
    passwords: ${{ secrets.GITHUB_TOKEN }},${{ secrets.INTERNAL_NUGET_PAT }}
```