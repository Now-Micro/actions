# String Manipulator

This action applies regex-based matching and sequential replacements to a string, and can return captured groups as JSON.

## Usage

```yaml
- name: Capture a version number
  uses: ./string-manipulator
  with:
    string: 'release-1.2.3'
    regex: 'release-(\d+\.\d+\.\d+)'
    match-output-is-json: true
```