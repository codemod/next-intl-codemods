import {addImport, getImport, removeImport} from '@jssg/utils/javascript/imports';
import {parse} from 'codemod:ast-grep';
import {hookCallReplacement} from './build-plan.ts';
import type {FilePlan, HookKind} from './types.ts';
import {EXTRACTED_BY_HOOK, MODULE_BY_HOOK} from './types.ts';

const NEXT_INTL_MODULES = new Set(['next-intl', 'next-intl/server']);

/** @jssg/utils types its program nodes against a narrower Language than codemod:ast-grep's TSX root. */
type ImportProgram = Parameters<typeof getImport>[0];
function asImportProgram(node: ReturnType<ReturnType<typeof parse>['root']>): ImportProgram {
  return node as unknown as ImportProgram;
}

/**
 * Apply a file plan to source text using JSSG import helpers + offset rewrites.
 * Returns null when nothing changes.
 */
export function applyFilePlanToSource(
  source: string,
  plan: FilePlan,
  language: 'tsx' | 'typescript' = 'tsx'
): string | null {
  let text = source;
  const edits: Array<{start: number; end: number; replacement: string}> = [];

  for (const call of plan.callRewrites) {
    edits.push({start: call.argStart, end: call.argEnd, replacement: call.replacement});
  }

  for (const rewrite of plan.hookRewrites) {
    const local = EXTRACTED_BY_HOOK[rewrite.hook];
    edits.push({
      start: rewrite.hookCallStart,
      end: rewrite.hookCallEnd,
      replacement: hookCallReplacement(rewrite, local)
    });
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of edits) {
    text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
  }

  text = stripDeadHookAliases(text);
  text = rewriteRequireDestructures(text, plan);
  text = rewriteImports(text, plan, language);

  return text === source ? null : text;
}

function stripDeadHookAliases(source: string): string {
  return source
    .replace(/^\s*const\s+\w+\s*=\s*useTranslations\s*;\s*\n/gm, '')
    .replace(/^\s*const\s+\w+\s*=\s*getTranslations\s*;\s*\n/gm, '');
}

function rewriteRequireDestructures(source: string, plan: FilePlan): string {
  let text = source;
  for (const hook of ['use', 'get'] as HookKind[]) {
    if (!plan.convertHook[hook] || plan.keepOldHook[hook]) continue;
    if (plan.hookRewrites.some((r) => r.hook === hook && r.namespaceObjectText)) continue;
    const oldName = hook === 'use' ? 'useTranslations' : 'getTranslations';
    const extracted = EXTRACTED_BY_HOOK[hook];
    const mod = MODULE_BY_HOOK[hook];
    text = text.replace(
      new RegExp(
        `(const\\s*\\{[^}]*?)\\b${oldName}\\b([^}]*\\}\\s*=\\s*require\\(['"]${escapeRegExp(mod)}['"]\\))`,
        'g'
      ),
      `$1${extracted}$2`
    );
  }
  return text;
}

function rewriteImports(source: string, plan: FilePlan, language: 'tsx' | 'typescript'): string {
  let text = source;
  for (const hook of ['use', 'get'] as HookKind[]) {
    if (!plan.convertHook[hook]) continue;
    const onlyNamespace = plan.hookRewrites
      .filter((r) => r.hook === hook)
      .every((r) => r.namespaceObjectText);
    if (onlyNamespace && plan.hookRewrites.some((r) => r.hook === hook)) continue;

    const canonical = MODULE_BY_HOOK[hook];
    const fromSource = plan.importSourceByHook[hook] ?? canonical;
    const moduleName = NEXT_INTL_MODULES.has(fromSource) ? fromSource : canonical;
    const barrelSource = NEXT_INTL_MODULES.has(fromSource) ? null : fromSource;
    const oldName = hook === 'use' ? 'useTranslations' : 'getTranslations';
    const extracted = EXTRACTED_BY_HOOK[hook];
    const keepOld = plan.keepOldHook[hook] || bodyMentionsIdentifier(text, oldName);

    if (new RegExp(`require\\(['"]${escapeRegExp(moduleName)}['"]\\)`).test(text)) {
      continue;
    }

    let program = asImportProgram(parse(language, text).root());

    const fromCandidates = barrelSource ? [barrelSource, moduleName] : [moduleName];
    const oldImpFrom = fromCandidates.find((from) => getImport(program, {type: 'named', name: oldName, from}));
    const extractedFrom = fromCandidates.find((from) =>
      getImport(program, {type: 'named', name: extracted, from})
    );

    if (extractedFrom) {
      if (!keepOld && oldImpFrom) {
        const rm = removeImport(program, {type: 'named', specifiers: [oldName], from: oldImpFrom});
        if (rm) text = program.commitEdits(Array.isArray(rm) ? rm : [rm]);
      }
      if (barrelSource) text = dropUnusedNamedImport(text, language, barrelSource, [oldName, 'useT', 'getT']);
      continue;
    }

    const finalFrom = chooseImportSource(text, barrelSource, moduleName);
    const oldImp = oldImpFrom
      ? getImport(program, {type: 'named', name: oldName, from: oldImpFrom})
      : null;

    if (!keepOld && oldImp && oldImpFrom) {
      const alias = oldImp.alias !== oldName ? oldImp.alias : undefined;
      const rm = removeImport(program, {type: 'named', specifiers: [oldName], from: oldImpFrom});
      if (rm) {
        text = program.commitEdits(Array.isArray(rm) ? rm : [rm]);
        program = asImportProgram(parse(language, text).root());
      }
      const add = addImport(program, {
        type: 'named',
        from: finalFrom,
        specifiers: [alias ? {name: extracted, alias} : {name: extracted}]
      });
      if (add) text = program.commitEdits(Array.isArray(add) ? add : [add]);
      if (alias && alias !== extracted) text = text.replaceAll(`${extracted}(`, `${alias}(`);
      if (barrelSource) text = dropUnusedNamedImport(text, language, barrelSource, [oldName, 'useT', 'getT']);
      continue;
    }

    const add = addImport(program, {
      type: 'named',
      from: finalFrom,
      specifiers: [{name: extracted}]
    });
    if (add) text = program.commitEdits(Array.isArray(add) ? add : [add]);

    if (barrelSource) {
      text = dropUnusedNamedImport(text, language, barrelSource, [oldName, 'useT', 'getT']);
    }
  }
  return text;
}

function bodyMentionsIdentifier(source: string, name: string): boolean {
  const body = source
    .split('\n')
    .filter((line) => !/^\s*import\b/.test(line))
    .join('\n');
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(body);
}

function chooseImportSource(
  fileText: string,
  barrelSource: string | null,
  canonical: string
): string {
  if (!barrelSource) return canonical;
  // Renamed local re-export consumer (`useT` / `getT`) — pull useExtracted from next-intl.
  if (/\buseT\b/.test(fileText) || /\bgetT\b/.test(fileText)) {
    if (!/\buseTranslations\b/.test(fileText) && !/\bgetTranslations\b/.test(fileText)) {
      return canonical;
    }
  }
  if (fileText.includes(`from '${barrelSource}'`) || fileText.includes(`from "${barrelSource}"`)) {
    return barrelSource;
  }
  return canonical;
}

function dropUnusedNamedImport(
  source: string,
  language: 'tsx' | 'typescript',
  from: string,
  names: string[]
): string {
  let text = source;
  let program = asImportProgram(parse(language, text).root());
  for (const candidate of names) {
    const imp = getImport(program, {type: 'named', name: candidate, from});
    if (!imp) continue;
    const local = imp.alias ?? candidate;
    const body = text
      .split('\n')
      .filter((line) => !line.includes(`'${from}'`) && !line.includes(`"${from}"`))
      .join('\n');
    if (!new RegExp(`\\b${escapeRegExp(local)}\\b`).test(body)) {
      const rm = removeImport(program, {type: 'named', specifiers: [candidate], from});
      if (rm) {
        text = program.commitEdits(Array.isArray(rm) ? rm : [rm]);
        program = asImportProgram(parse(language, text).root());
      }
    }
  }
  return text;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
