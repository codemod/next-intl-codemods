# use-translations-to-use-extracted

Migrates next-intl `useTranslations` / `getTranslations` call sites with **static** keys to
[`useExtracted` / `getExtracted`](https://next-intl.dev/docs/usage/extraction) with inline messages,
and carries existing catalog translations over so nothing has to be translated again.

```bash
# Run against your Next.js app (the folder that contains messages/{locale}.json)
npx codemod use-translations-to-use-extracted -t .
```

Prefer a clean working tree: commit or stash first, then review with `git diff`.

Do **not** run this against the registry package repo itself — point `-t` at the app that
owns the catalogs (override with `--param messages=…` / `--param sourceLocale=…` if needed).

`--dry-run` prevents **apply** from writing source files and skips writing extraction catalogs.
The CLI also skips persisting workflow state across steps and blocks real-disk `fs` writes, so the
mine → apply handoff cannot use state or `findings.json`; apply re-scans the tree instead. Prefer a
non-dry-run run on a clean branch for the full semantic mine pass.

## What it does

```tsx
// before
import {useTranslations} from 'next-intl';
const t = useTranslations('Checkout');
t('title');
t.rich('terms', {link: (chunks) => <a>{chunks}</a>});

// after
import {useExtracted} from 'next-intl';
const t = useExtracted();
t('Checkout');
t.rich('Please accept the <link>terms</link>.', {link: (chunks) => <a>{chunks}</a>});
```

1. Replaces static keys with source-locale catalog text. Ids match the extractor (SHA-512,
   base64url, 6 chars), so a later `next dev` / `next build` leaves catalogs untouched.
2. Writes extraction catalogs (`po` or `json`) for every locale with old translations filled in.
   Existing extraction catalogs are merged, never overwritten. A `.po` file in the previous
   next-intl layout (keys in `msgid`) stops the run before anything changes.
3. If one source text was translated differently under different keys, each distinct translation
   set keeps an explicit id (the old key):
   ```tsx
   t({id: 'pricing.enterprise.seats', message: 'Unlimited'});
   ```
4. Leaves extractor-unsafe patterns untouched: dynamic keys/namespaces, `t.raw` / `t.has`, optional
   calls, unbound hook results, keys missing from catalogs. The old hook import stays while any
   binding in the file still needs it.

Discovery uses **semantic analysis** (`definition()` / `references()`) and `@jssg/utils` import
helpers, so named / aliased / namespace / `require` / local barrel / renamed re-export call sites are
in scope — see [Compared to seob717/next-intl-codemod](#compared-to-seob717next-intl-codemod).

## Workflow parameters

| Param | Default | Description |
| --- | --- | --- |
| `messages` | `messages/{locale}.json` | Old catalogs; `{locale}` is required (`*` merges several files per locale) |
| `sourceLocale` | `en` | Locale whose texts become inline messages (must match `messages.sourceLocale`) |
| `out` | `messages` | Extraction catalog output directory |
| `format` | `po` | `po` or `json` |
| `namespace` | `none` | `none` \| `first-segment` \| `keep` |

## Requirements

- **`format=po`** needs **next-intl ≥ 4.14.0**. Older extractors erase the new PO layout on the next
  `next dev` / `next build`; the codemod stops if it finds an older version.
- **`format=json`**: `out` must differ from the old catalog folder. The extractor deletes keys it
  cannot find in code (including ones skipped bindings still need); overlapping paths are rejected.
- Only `.ts` / `.tsx` / `.js` / `.jsx` are rewritten — the same set next-intl’s extractor scans.
- Texts are normalized to **NFC** before inline messages and ids (editors save NFC). Normalized keys
  appear under `normalizedKeys` in the report.
- Missing source-locale keys cannot be inlined (`missing-key`). Target locales without a translation
  get an empty entry (empty string, not next-intl’s missing-message fallback).

## Report and metrics

Artifacts land under `.codemod-next-intl/` when the apply step builds the plan:

| File | Contents |
| --- | --- |
| `findings.json` | Mined bindings (written during mine; required under `--dry-run`) |
| `plan.json` | Apply plan |
| `report.json` | Skipped bindings + reasons, conflicts, `unreferencedKeys`, `keyMap` (old key → id), `valuesNotInMessage`, `normalizedKeys` |

Console summary mirrors the seob717 CLI: converted/skipped counts, conflict explicit-id totals,
skip-reason histogram, and pointers to `plan` / `report`.

| Metric | Meaning |
| --- | --- |
| `next_intl_binding_mined` | Per binding (`hook` = `use`\|`get`, `outcome` = `ok`\|`problem`) |
| `next_intl_binding` | Apply convert (`hook`, `outcome` = `converted`) |
| `next_intl_call_converted` | Converted call sites |

## Workflow

1. **mine** — JSSG + `semantic_analysis: workspace`; accumulates findings in state and `.codemod-next-intl/findings.json`
2. **apply** — builds `plan.json` / catalogs **once** on the first file, then rewrites sources (`@jssg/utils`, no semantic pass)

Both steps are `js-ast-grep`, so npm deps are Rolldown-bundled at publish — no shell `node` /
`npm install` steps.

## After running

Point next-intl at the new catalogs before the app runs.

1. Enable extraction in `next.config.ts` with the same `out` / `format` / `sourceLocale`:

   ```ts
   import createNextIntlPlugin from 'next-intl/plugin';

   const withNextIntl = createNextIntlPlugin({
     experimental: {
       srcPath: './src',
       extract: true,
       messages: {path: './messages', format: 'po', locales: 'infer', sourceLocale: 'en'}
     }
   });

   export default withNextIntl({});
   ```

2. While skipped bindings still read the old catalog, **deep-merge** both in `i18n/request.ts`. A
   shallow spread breaks nested namespaces when an explicit id like `Nav.home` lands as
   `{Nav: {home}}`:

   ```ts
   type Messages = {[key: string]: string | Messages};

   function merge(a: Messages, b: Messages): Messages {
     const result = {...a};
     for (const [key, value] of Object.entries(b)) {
       const prev = result[key];
       result[key] =
         typeof prev === 'object' && typeof value === 'object' ? merge(prev, value) : value;
     }
     return result;
   }

   export default getRequestConfig(async ({requestLocale}) => {
     // …resolve `locale` as before
     return {
       locale,
       messages: merge(
         (await import(`../../messages/${locale}.json`)).default, // old catalog
         (await import(`../../messages/${locale}.po`)).default // written by the codemod
       )
     };
   });
   ```

   Once `report.json` has no skipped bindings, drop the old catalog and import the extraction file
   only.

Then:

- Rewrite dynamic keys to static forms ([static analysis](https://next-intl.dev/docs/usage/extraction#static-analysis)).
- Delete migrated keys from old catalogs when nothing reads them (`unreferencedKeys` lists static misses).
- Run `tsc`. `useExtracted` types `values` from the inline message; fix `valuesNotInMessage` entries
  (add the tag/arg to the source text or switch to `t.rich`) and number args that need `{arg, number}`.
- Run the app once: the extractor should rewrite nothing if the migration is consistent.

## With an AI coding agent

Let the codemod carry translations and conflict ids deterministically, then hand the agent the rest:

```
Run `npx codemod use-translations-to-use-extracted`.
Open `.codemod-next-intl/report.json`: rewrite each binding under `skipped` so its keys are static
(https://next-intl.dev/docs/usage/extraction#static-analysis), fix tsc errors for
`valuesNotInMessage`, and run the codemod again until nothing is skipped.
```

## Compared to [seob717/next-intl-codemod](https://github.com/seob717/next-intl-codemod)

That CLI is a careful hand-rolled TypeScript scanner (`createProgram` + string prefilter + offset
splices). This package keeps the same migration *ideas* (inline source-locale text, conflict ids,
catalog merge, NFC, guards, report shape, post-run deep-merge guidance) but runs on Codemod toolkit
primitives.

### Gaps fixed (semantic analysis + `@jssg/utils`)

| Gap | Hand-rolled CLI | This package |
| --- | --- | --- |
| Namespace import `import * as intl` / `intl.useTranslations` | Missed (callee must be an identifier) | Resolved via semantic property access |
| Hook alias `const hook = useTranslations; hook('Home')` | Missed (import-symbol keyed map) | Follows `definition()` / aliases |
| Rebound translator `const tr = t; tr('title')` | Skipped as `translator-used-outside-call` | Tracks rebound locals with static calls |
| Computed member `t['rich']` / `t['markup']` | Only `.rich` / `.markup` recognized | Handles computed string members |
| Local barrel `import {useTranslations} from './i18n'` | Exact `'next-intl'` module string only | Workspace semantics + barrel re-exports |
| `require('next-intl')` destructure | Only `ImportDeclaration` scanned | Supported |
| Renamed re-export `import {useT} from './i18n'` | File never scanned (substring prefilter) | No name-substring gate; follows re-exports |
| ICU escaped braces `'{name}'` vs real `{name}` | Regex `icuNames` treats escapes as placeholders | `@formatjs/icu-messageformat-parser` |

Fixtures: `tests/namespace-import`, `hook-alias`, `rebound-translator`, `computed-rich`,
`barrel-reexport`, `require-destructure`, `renamed-reexport`, `icu-escaped-braces`.

### Carried over from that project (deliberately)

- Extractor-compatible message ids and conflict clustering with explicit ids
- Catalog merge + PO-layout / json-overlap / next-intl version guards
- NFC normalization and empty target-locale entries
- Full `report.json` (`skipped`, `conflicts`, `unreferencedKeys`, `keyMap`, `valuesNotInMessage`, …)
- Post-migration next-intl config + deep-merge loading pattern
- Agent loop: codemod first, then fix skips from the report

### Extra from the toolkit port

- Durable `mine` → `apply` workflow with `.codemod-next-intl/` artifacts
- Safe import edits via `@jssg/utils` (`addImport` / `removeImport` / `getImport`)
- First-class metrics atoms
- Registry package (`use-translations-to-use-extracted`) with param defaults (`messages`, `sourceLocale`)
- Catalog planning bundled into apply (no extra full-tree pass / shell Node step)
