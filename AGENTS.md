# Agent instructions

- Install packages via pnpm rather than editing package.json directly
- Bias towards making new test files that are roughly logically grouped rather than letting test files gets too large. Try to stay below 600 lines.
- Prefer asserting the full STDOUT/STDERR output rather than using to.contain or to.not.contain
- Always also add `comparison-tests` for major command functionality, but edge cases should always be covered in unit tests which are mush faster
- When you are unsure about bash/command behavior, create a `comparison-tests` test file to ensure compat.
- `--help` does not need to pass comparison tests and should reflect actual capability
