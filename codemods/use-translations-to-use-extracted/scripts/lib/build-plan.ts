import path from 'node:path';
import type {LoadedCatalogs} from './catalog.ts';
import {generateId} from './id.ts';
import {icuNames} from './icu.ts';
import {relativePosix} from './paths.ts';
import {toStringLiteral} from './string-literal.ts';
import type {
  ApplyPlan,
  BindingFinding,
  CallRewrite,
  CallSiteFinding,
  FileFindings,
  FilePlan,
  HookKind,
  HookRewrite,
  NamespaceStrategy,
  PlannedMessage,
  Problem,
  Report
} from './types.ts';
import {EXTRACTED_BY_HOOK} from './types.ts';

type ResolvedCall = {
  call: CallSiteFinding;
  fullKey: string;
  text: string;
  normalized: boolean;
};

type GroupEntry = {
  fullKey: string;
  translations: Record<string, string>;
  sites: Array<{file: string; call: CallSiteFinding}>;
};

function resolveBinding(
  binding: BindingFinding,
  catalogs: LoadedCatalogs,
  sourceLocale: string
): {resolved: ResolvedCall[]; problems: Problem[]} {
  const source = catalogs.byLocale.get(sourceLocale)!;
  const problems = [...binding.problems];
  const resolved: ResolvedCall[] = [];
  if (problems.some((problem) => problem.reason === 'dynamic-namespace')) {
    return {resolved, problems};
  }
  for (const call of binding.calls) {
    const fullKey = binding.namespace ? `${binding.namespace}.${call.key}` : call.key!;
    const raw = source.get(fullKey);
    const text = raw?.normalize('NFC');
    if (text !== undefined && text.trim() === '') {
      problems.push({reason: `empty-message: ${fullKey}`, line: call.line, column: call.column});
      continue;
    }
    if (text === undefined) {
      const reason = catalogs.nonString.has(fullKey)
        ? 'non-string-message'
        : [...source.keys()].some((key) => key.startsWith(`${fullKey}.`))
          ? 'key-refers-to-namespace-object'
          : 'missing-key';
      problems.push({reason: `${reason}: ${fullKey}`, line: call.line, column: call.column});
      continue;
    }
    resolved.push({call, fullKey, text, normalized: raw !== text});
  }
  return {resolved, problems};
}

function pickNamespace(
  binding: BindingFinding,
  resolved: ResolvedCall[],
  strategy: NamespaceStrategy
): string | undefined {
  if (strategy === 'none') return undefined;
  if (strategy === 'keep') return binding.namespace;
  const firstSegments = new Set(
    resolved.map(({fullKey}) => (fullKey.includes('.') ? fullKey.split('.')[0] : undefined))
  );
  return firstSegments.size === 1 ? [...firstSegments][0] : undefined;
}

function compareReferences(
  a: {path: string; line: number; column: number},
  b: {path: string; line: number; column: number}
): number {
  return a.path.localeCompare(b.path, 'en') || a.line - b.line || a.column - b.column;
}

export type BuildPlanOptions = {
  projectRoot: string;
  sourceLocale: string;
  namespace: NamespaceStrategy;
  format: 'po' | 'json';
  outDir: string;
};

export function buildApplyPlan(
  findingsByFile: Record<string, FileFindings>,
  catalogs: LoadedCatalogs,
  options: BuildPlanOptions
): ApplyPlan {
  const targetLocales = catalogs.locales.filter((locale) => locale !== options.sourceLocale);
  const skipped: Report['skipped'] = [];
  const referencedKeys = new Set<string>();
  const groups = new Map<string, {namespace?: string; text: string; entries: Map<string, GroupEntry>}>();
  const pendingCalls: Array<{
    file: string;
    call: CallSiteFinding;
    groupKey: string;
    fullKey: string;
  }> = [];
  const filePlans = new Map<string, FilePlan>();
  let convertedBindings = 0;
  let convertedCalls = 0;
  const normalizedKeys = new Set<string>();
  const valuesNotInMessage: Report['valuesNotInMessage'] = [];

  function ensureFilePlan(file: string): FilePlan {
    let plan = filePlans.get(file);
    if (!plan) {
      plan = {
        file,
        keepOldHook: {use: false, get: false},
        convertHook: {use: false, get: false},
        importSourceByHook: {},
        oldLocalByHook: {},
        hookRewrites: [],
        callRewrites: []
      };
      filePlans.set(file, plan);
    }
    return plan;
  }

  for (const scannedFile of Object.values(findingsByFile)) {
    const {file} = scannedFile;
    for (const binding of scannedFile.bindings) {
      const {resolved, problems} = resolveBinding(binding, catalogs, options.sourceLocale);
      for (const {fullKey} of resolved) referencedKeys.add(fullKey);
      if (problems.length > 0) {
        const plan = ensureFilePlan(file);
        plan.keepOldHook[binding.hook] = true;
        skipped.push({
          file: relativePosix(options.projectRoot, file),
          name: binding.name,
          hook: binding.hook,
          line: binding.problems[0]?.line ?? problems[0]?.line ?? 1,
          column: binding.problems[0]?.column ?? problems[0]?.column ?? 0,
          problems
        });
        continue;
      }

      convertedBindings++;
      const namespace = pickNamespace(binding, resolved, options.namespace);
      const plan = ensureFilePlan(file);
      plan.convertHook[binding.hook] = true;
      if (binding.importSource) {
        plan.importSourceByHook[binding.hook] = binding.importSource;
      }
      plan.hookRewrites.push({
        hookCallStart: binding.hookCallStart,
        hookCallEnd: binding.hookCallEnd,
        hook: binding.hook,
        namespace,
        otherHookProps: binding.otherHookProps,
        namespaceObjectText: binding.namespaceObjectText
      });

      for (const {call, fullKey, text: messageText, normalized} of resolved) {
        convertedCalls++;
        if (normalized) normalizedKeys.add(fullKey);
        if (call.valueKeys) {
          const {args, tags} = icuNames(messageText);
          const declared = call.method === 'call' ? args : new Set([...args, ...tags]);
          const extra = call.valueKeys.filter((name) => !declared.has(name));
          if (extra.length > 0) {
            valuesNotInMessage.push({
              file: relativePosix(options.projectRoot, file),
              line: call.line,
              column: call.column,
              key: fullKey,
              values: extra
            });
          }
        }
        const groupKey = `${namespace ?? ''}\u0000${messageText}`;
        let group = groups.get(groupKey);
        if (!group) {
          group = {namespace, text: messageText, entries: new Map()};
          groups.set(groupKey, group);
        }
        let entry = group.entries.get(fullKey);
        if (!entry) {
          const translations: Record<string, string> = {};
          for (const locale of targetLocales) {
            translations[locale] = catalogs.byLocale.get(locale)?.get(fullKey) ?? '';
          }
          entry = {fullKey, translations, sites: []};
          group.entries.set(fullKey, entry);
        }
        entry.sites.push({file, call});
        pendingCalls.push({file, call, groupKey, fullKey});
      }
    }
  }

  const messages: PlannedMessage[] = [];
  const conflicts: Report['conflicts'] = [];
  const idByGroupAndKey = new Map<string, {localId: string; explicit: boolean}>();
  const usedIds = new Set<string>();

  for (const [groupKey, group] of groups) {
    const clusters = new Map<string, GroupEntry[]>();
    for (const entry of group.entries.values()) {
      const signature = JSON.stringify(targetLocales.map((locale) => entry.translations[locale]));
      const list = clusters.get(signature) ?? [];
      list.push(entry);
      clusters.set(signature, list);
    }
    const isConflict = clusters.size > 1;
    const conflict: Report['conflicts'][number] = {
      namespace: group.namespace,
      message: group.text,
      clusters: []
    };
    const prefix = group.namespace ? `${group.namespace}.` : '';

    for (const entries of clusters.values()) {
      entries.sort((a, b) => a.fullKey.localeCompare(b.fullKey, 'en'));
      let localId = generateId(group.text);
      if (isConflict) {
        const first = entries[0]!.fullKey;
        localId = first.startsWith(prefix) ? first.slice(prefix.length) : first;
      }
      const id = `${prefix}${localId}`;
      if (usedIds.has(id)) throw new Error(`Generated id collision: ${id}`);
      usedIds.add(id);

      const references: PlannedMessage['references'] = [];
      for (const entry of entries) {
        idByGroupAndKey.set(`${groupKey}\u0000${entry.fullKey}`, {localId, explicit: isConflict});
        for (const {file, call} of entry.sites) {
          references.push({
            path: relativePosix(options.projectRoot, file),
            line: call.line,
            column: call.column
          });
        }
      }
      messages.push({
        id,
        message: group.text,
        references: references.sort(compareReferences),
        translations: entries[0]!.translations,
        explicitId: isConflict,
        oldKeys: entries.map((entry) => entry.fullKey)
      });
      conflict.clusters.push({
        id,
        oldKeys: entries.map((entry) => entry.fullKey),
        translations: entries[0]!.translations
      });
    }
    if (isConflict) conflicts.push(conflict);
  }

  for (const {file, call, fullKey, groupKey} of pendingCalls) {
    const {localId, explicit} = idByGroupAndKey.get(`${groupKey}\u0000${fullKey}`)!;
    const text = groups.get(groupKey)!.text;
    const replacement = explicit
      ? `{id: ${toStringLiteral(localId)}, message: ${toStringLiteral(text)}}`
      : toStringLiteral(text);
    const plan = ensureFilePlan(file);
    plan.callRewrites.push({
      argStart: call.argStart,
      argEnd: call.argEnd,
      replacement
    });
  }

  // Drop file plans with no conversions.
  for (const [file, plan] of [...filePlans]) {
    const converted = (['use', 'get'] as HookKind[]).some((h) => plan.convertHook[h]);
    if (!converted) filePlans.delete(file);
  }

  const source = catalogs.byLocale.get(options.sourceLocale)!;
  const withoutNextIntlImport = Object.values(findingsByFile)
    .filter((f) => f.unresolvedHookMentions && f.bindings.length === 0)
    .map((f) => relativePosix(options.projectRoot, f.file));

  const keyMap = Object.fromEntries(messages.flatMap((m) => m.oldKeys.map((key) => [key, m.id])));
  const report: Report = {
    files: {
      scanned: Object.keys(findingsByFile).length,
      changed: filePlans.size,
      withoutNextIntlImport
    },
    bindings: {converted: convertedBindings, skipped: skipped.length},
    calls: {converted: convertedCalls},
    messages: {total: messages.length, explicitIds: messages.filter((m) => m.explicitId).length},
    normalizedKeys: [...normalizedKeys],
    valuesNotInMessage,
    skipped,
    conflicts,
    nonStringKeys: [...catalogs.nonString.keys()],
    catalogCollisions: catalogs.collisions,
    unreferencedKeys: [...source.keys()].filter((key) => !referencedKeys.has(key)),
    keyMap
  };

  return {
    projectRoot: options.projectRoot,
    sourceLocale: options.sourceLocale,
    namespace: options.namespace,
    format: options.format,
    outDir: path.resolve(options.projectRoot, options.outDir),
    files: [...filePlans.values()],
    messages,
    keyMap,
    report
  };
}

export function hookCallReplacement(rewrite: HookRewrite, localName: string): string {
  let args = '';
  // Treat null like undefined (JSON round-trips / shared state can null omitted fields).
  const namespace = rewrite.namespace ?? undefined;
  if (rewrite.otherHookProps) {
    const props = [...rewrite.otherHookProps];
    if (namespace !== undefined) props.push(`namespace: ${toStringLiteral(namespace)}`);
    args = props.length > 0 ? `{${props.join(', ')}}` : '';
  } else if (namespace !== undefined) {
    args = toStringLiteral(namespace);
  }
  const callee = rewrite.namespaceObjectText
    ? `${rewrite.namespaceObjectText}.${EXTRACTED_BY_HOOK[rewrite.hook]}`
    : localName;
  return `${callee}(${args})`;
}

export {EXTRACTED_BY_HOOK};
