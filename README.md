# next-intl-codemods

Codemod toolkit packages for [next-intl](https://next-intl.dev) migrations, published to the Codemod Registry.

## Packages

| Package | Description |
| --- | --- |
| [`codemods/next-intl-use-extracted`](./codemods/next-intl-use-extracted) | Migrate `useTranslations` / `getTranslations` → `useExtracted` / `getExtracted` |

## Develop

```bash
pnpm install
pnpm test
pnpm check-types
```

```bash
pnpm --filter ./codemods/next-intl-use-extracted test
pnpm --filter ./codemods/next-intl-use-extracted check-types
```
