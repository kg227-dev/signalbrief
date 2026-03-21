# test-support

Shared assertion helpers used by sidecar `.test.js` files throughout the repository to verify module syntax, source shape, and export contracts.

## Files

| File | Purpose | Output | Dependencies |
|------|---------|--------|--------------|
| `module-contract-helper.js` | Exports three assertion functions: `assertNodeSyntaxFile` (runs `node --check` on a file), `assertSourceIncludesFile` (checks that source text contains required snippets), and `assertModuleExports` (verifies a module's default export is a non-null object or function) | Throws on failure via `node:assert`; no return value on success | `node:assert`, `node:child_process`, `node:fs` |

## Usage in test files

Sidecar test files (co-located `*.test.js` modules discovered and run by `scripts/test-critical-paths.js`) require helpers from this directory directly:

```js
const { assertNodeSyntaxFile, assertSourceIncludesFile, assertModuleExports } = require("../../test-support/module-contract-helper");
```

Each helper throws an `AssertionError` on failure, which causes the test runner to report a failing test. Helpers are intentionally dependency-free so they can run anywhere Node.js stdlib is available without installing packages.
