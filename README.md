# next-intl-codemods

Codemod registry workspace for [next-intl](https://next-intl.dev) migrations.

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
