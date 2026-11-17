# AGENTS.md

This is a Codemod registry workspace for next-intl migration packages.

- Use **pnpm** (`packageManager` in root `package.json`).
- Toolkit codemods live under `codemods/<name>/` with `codemod.yaml`, `workflow.yaml`, `scripts/`, and `tests/`.
- Before claiming done: `pnpm --filter ./codemods/<pkg> test` and `pnpm --filter ./codemods/<pkg> check-types`.
- Codemod name in `codemod.yaml` should use the `@codemod/` scope.
