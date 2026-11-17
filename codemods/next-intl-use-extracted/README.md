# @codemod/next-intl-use-extracted

Codemod toolkit package that migrates `useTranslations` / `getTranslations` with static keys to
`useExtracted` / `getExtracted`, and carries existing translations into extraction catalogs.

Uses JSSG + semantic analysis + `@jssg/utils` + metrics + workflow params.

## Run

```bash
npx codemod workflow run -w codemods/next-intl-use-extracted/workflow.yaml \
  --param messages='messages/{locale}.json' \
  --param sourceLocale=en \
  --param out=extracted \
  --param format=po \
  --param namespace=none
```

Prefer `--dry-run` before applying.

### Params

| Param | Required | Default | Description |
| --- | --- | --- | --- |
| `messages` | yes | — | Old catalogs with `{locale}` |
| `sourceLocale` | yes | — | Locale used for inline messages |
| `out` | no | `messages` | Extraction catalog output directory |
| `format` | no | `po` | `po` or `json` |
| `namespace` | no | `none` | `none` \| `first-segment` \| `keep` |

## Workflow

1. **mine** — `scripts/mine.ts` with `semantic_analysis: workspace`; records findings + metrics
2. **write-catalogs** — Node step builds `plan.json`, writes catalogs, enforces safety guards
3. **apply** — `scripts/apply.ts` rewrites sources from the plan using `@jssg/utils` imports

`scripts/codemod.ts` is the self-contained entry used by `jssg test`.

## Metrics

Insights metrics are the primary observability surface:

- `next_intl_binding_mined` / `next_intl_binding` — binding outcomes
- `next_intl_call_converted` — converted call sites

`report.json` is still written under `.codemod-next-intl/` for agents when catalogs are emitted.

## Known skips

Extractor-unsafe cases are left alone (recorded as skip reasons):

- Dynamic keys / namespaces
- `t.raw` / `t.has`
- Optional calls (`t?.()`, `t.rich?.()`)
- Hook results not bound to a variable

## Develop

```bash
pnpm install
pnpm --filter ./codemods/next-intl-use-extracted test
pnpm --filter ./codemods/next-intl-use-extracted check-types
```
