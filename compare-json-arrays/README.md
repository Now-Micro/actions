# Compare JSON Arrays

This action compares two JSON array strings and returns a JSON array based on the selected mode: `intersection`, `union`, `left-diff`, `right-diff`, or `unique`.

## Usage

```yaml
- name: Compare arrays
  uses: ./compare-json-arrays
  with:
    array-a: '["a","b","c"]'
    array-b: '["b","c","d"]'
    mode: intersection
```