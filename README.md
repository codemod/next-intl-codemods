# next-intl-codemods

Codemod registry workspace for [next-intl](https://next-intl.dev) migrations.

Licensed under the [MIT License](./LICENSE).
Copyright (c) 2026 Codemod Inc. and seob717.
Originally started by [seob717](https://github.com/seob717/next-intl-codemod).

The root `package.json` is the **pnpm workspace** only. Each publishable codemod lives under
`codemods/<slug>/` with its own `package.json`, `codemod.yaml`, and `workflow.yaml`.

| Package | Description |
| --- | --- |
| [`use-translations-to-use-extracted`](./codemods/use-translations-to-use-extracted) | `useTranslations` / `getTranslations` → `useExtracted` / `getExtracted` |

```bash
pnpm install
pnpm test
pnpm check-types
```
