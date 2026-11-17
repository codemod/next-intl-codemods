# AGENTS.md

Codemod registry workspace for next-intl migrations.

- Use **pnpm** (`packageManager` in the root `package.json`).
- Each codemod is `codemods/<slug>/` with `codemod.yaml`, `workflow.yaml`, `scripts/`, `tests/`.
- Root `package.json` is workspace tooling only — do not put transforms there.
- Keep `codemod.yaml` `name` and package `name` identical (unscoped slug, e.g. `use-translations-to-use-extracted`).
- Before claiming done: `pnpm --filter ./codemods/<slug> test` and `check-types`.
