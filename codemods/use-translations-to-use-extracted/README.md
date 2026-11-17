# @codemod/use-translations-to-use-extracted

Migrates next-intl `useTranslations` / `getTranslations` call sites with **static** keys to
`useExtracted` / `getExtracted`, and carries existing catalog translations into extraction
catalogs (`po` or `json`).

## What it does

- Resolves hooks via **semantic analysis** (named, aliased, namespace, `require`, local barrels,
  renamed re-exports) using `definition()` / `references()` and `@jssg/utils` import helpers.
- Inlines source-locale messages and rewrites `t('key')` / `t.rich` / `t.markup` (including
  `t['rich']`) to extracted call forms.
- Writes extraction catalogs and a `plan.json` for the apply pass; keeps old hooks when a binding
  cannot be safely converted.
- Skips extractor-unsafe patterns: dynamic keys/namespaces, `t.raw` / `t.has`, optional calls,
  unbound hook results.

## Workflow parameters

| Param | Default | Description |
| --- | --- | --- |
| `messages` | `messages/{locale}.json` | Old catalogs; `{locale}` is required |
| `sourceLocale` | `en` | Locale whose texts become inline messages |
| `out` | `messages` | Extraction catalog output directory |
| `format` | `po` | `po` or `json` |
| `namespace` | `none` | `none` \| `first-segment` \| `keep` |

## Metrics

| Metric | Meaning |
| --- | --- |
| `next_intl_binding_mined` | Per-file binding discovery (`hook`, `outcome`) |
| `next_intl_binding` | Binding convert/skip outcomes during apply |
| `next_intl_call_converted` | Converted call sites |

## Workflow

1. **mine** — JSSG + `semantic_analysis: workspace`; records findings and metrics
2. **write-catalogs** — builds `plan.json`, merges catalogs, enforces safety guards
3. **apply** — rewrites sources from the plan with `@jssg/utils` import edits + `commitEdits`
