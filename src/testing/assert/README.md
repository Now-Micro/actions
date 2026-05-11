# Assert

This action makes workflow assertions and writes the result to a summary file so GitHub Actions can display test-like output.

## Usage

```yaml
- name: Assert response
  uses: ./src/testing/assert
  with:
    test-name: responds with the expected value
    actual: hello
    expected: hello
    mode: exact
    summary-file: ${{ runner.temp }}/assert-summary.md
    exit-on-fail: true
```