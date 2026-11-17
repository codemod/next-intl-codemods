/**
 * AST mining for next-intl translation hooks using JSSG + semantic analysis + @jssg/utils.
 */
import type {SgNode, SgRoot} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {importBindingOf} from './import-binding.ts';
import type {
  BindingFinding,
  CallMethod,
  CallSiteFinding,
  FileFindings,
  HookKind,
  Problem
} from './types.ts';
import {HOOK_BY_IMPORT, MODULE_BY_HOOK} from './types.ts';

type Node = SgNode<TSX>;

const NEXT_INTL_MODULES = new Set(['next-intl', 'next-intl/server']);

function safeDefinition(node: Node, resolveExternal = true) {
  try {
    return node.definition({resolveExternal});
  } catch {
    return null;
  }
}

function safeReferences(node: Node) {
  try {
    return node.references();
  } catch {
    return [];
  }
}

function unwrap(node: Node | null | undefined): Node | null {
  if (!node) return null;
  let current = node;
  while (current.kind() === 'parenthesized_expression' || current.kind() === 'await_expression') {
    const inner =
      current.kind() === 'await_expression'
        ? (current.child(1) as Node | null)
        : (current.child(1) as Node | null);
    if (!inner) break;
    current = inner;
  }
  return current;
}

function stringLiteralText(node: Node | null | undefined): string | undefined {
  if (!node) return undefined;
  if (node.kind() === 'string') {
    const frag = node.find({rule: {kind: 'string_fragment'}});
    return frag?.text() ?? node.text().slice(1, -1);
  }
  if (node.kind() === 'template_string') {
    // Only accept no-substitution templates.
    if (node.children().some((c) => c.kind() === 'template_substitution')) return undefined;
    const frags = node.findAll({rule: {kind: 'string_fragment'}});
    return frags.map((f) => f.text()).join('');
  }
  return undefined;
}

function moduleMatches(source: string, hook: HookKind): boolean {
  return source === MODULE_BY_HOOK[hook];
}

function isNextIntlHookName(name: string): boolean {
  return Object.hasOwn(HOOK_BY_IMPORT, name);
}

function hookKindForImportName(name: string): HookKind {
  return HOOK_BY_IMPORT[name]!;
}

export type ResolvedHook = {
  hook: HookKind;
  /** Specifier of the import in the current file (may be a local barrel). */
  importSource?: string;
};

/**
 * Resolve whether `node` (identifier or member property access callee) is a
 * useTranslations / getTranslations binding that originates from next-intl.
 */
export function resolveHookKind(node: Node): ResolvedHook | null {
  const kind = node.kind();

  // intl.useTranslations / ns.getTranslations
  if (kind === 'member_expression') {
    const prop = node.field('property');
    const propName = prop?.text();
    if (!propName || !isNextIntlHookName(propName)) return null;
    const hook = hookKindForImportName(propName);
    const object = node.field('object');
    if (!object) return null;

    const binding = importBindingOf(object);
    if (binding?.importedName === '*' && moduleMatches(binding.source, hook)) {
      return {hook, importSource: binding.source};
    }

    const def = safeDefinition(object, true);
    if (def?.kind === 'import') {
      const again = importBindingOf(object);
      if (again?.importedName === '*' && moduleMatches(again.source, hook)) {
        return {hook, importSource: again.source};
      }
    }
    return null;
  }

  if (kind !== 'identifier') return null;

  return resolveHookIdentifier(node);
}

function resolveHookIdentifier(node: Node, depth = 0): ResolvedHook | null {
  if (depth > 8) return null;

  const binding = importBindingOf(node);
  if (binding) {
    if (isNextIntlHookName(binding.importedName) && moduleMatches(binding.source, hookKindForImportName(binding.importedName))) {
      return {hook: hookKindForImportName(binding.importedName), importSource: binding.source};
    }
    // Re-export from a local module: follow into the defining file.
    if (!NEXT_INTL_MODULES.has(binding.source)) {
      const def = safeDefinition(node, true);
      if (def) {
        const exported = findExportedHookKind(
          def.node,
          binding.importedName === '*' ? node.text() : binding.importedName
        );
        if (exported) return {hook: exported, importSource: binding.source};
        const fromReexport = hookKindFromExportNode(def.node);
        if (fromReexport) return {hook: fromReexport, importSource: binding.source};
      }
      // Named import that is itself a next-intl hook (local barrel re-export).
      if (isNextIntlHookName(binding.importedName)) {
        return {hook: hookKindForImportName(binding.importedName), importSource: binding.source};
      }
      // Common renamed re-exports: useT / getT
      if (binding.importedName === 'useT' || binding.localName === 'useT') {
        return {hook: 'use', importSource: binding.source};
      }
      if (binding.importedName === 'getT' || binding.localName === 'getT') {
        return {hook: 'get', importSource: binding.source};
      }
    }
  }

  const def = safeDefinition(node, true);
  if (!def) return null;

  // const hook = useTranslations  (definition lands on the binding name identifier)
  if (def.node.kind() === 'identifier') {
    const parent = def.node.parent();
    if (parent?.kind() === 'variable_declarator' && parent.field('name')?.id() === def.node.id()) {
      const value = unwrap(parent.field('value') as Node | null);
      if (value?.kind() === 'identifier') return resolveHookIdentifier(value, depth + 1);
      if (value?.kind() === 'member_expression') return resolveHookKind(value);
    }
    if (def.node.id() !== node.id()) return resolveHookIdentifier(def.node, depth + 1);
  }

  if (def.node.kind() === 'variable_declarator') {
    const value = unwrap(def.node.field('value') as Node | null);
    if (value?.kind() === 'identifier') return resolveHookIdentifier(value, depth + 1);
    if (value?.kind() === 'member_expression') return resolveHookKind(value);
    if (value?.kind() === 'call_expression') {
      return null;
    }
  }

  const fromExport = hookKindFromExportNode(def.node);
  if (fromExport) {
    const bindingSource = importBindingOf(node)?.source;
    return {hook: fromExport, importSource: bindingSource};
  }

  if (def.kind === 'local') {
    const requireHook = hookKindFromRequireBinding(def.node, node.text());
    if (requireHook) return {hook: requireHook, importSource: MODULE_BY_HOOK[requireHook]};
  }

  return null;
}

function hookKindFromExportNode(node: Node): HookKind | null {
  // export { useTranslations as useT } from 'next-intl'
  // export_specifier name/alias
  let current: Node | null = node;
  if (current.kind() === 'identifier') {
    const parent = current.parent();
    if (parent) current = parent;
  }

  if (current.kind() === 'export_specifier' || current.kind() === 'import_specifier') {
    const nameNode = current.field('name');
    const exported = nameNode?.text();
    if (!exported || !isNextIntlHookName(exported)) return null;
    const hook = hookKindForImportName(exported);
    const statement = current.ancestors().find(
      (a) => a.kind() === 'export_statement' || a.kind() === 'import_statement'
    );
    const sourceNode = statement?.field('source');
    const source = sourceNode ? stringLiteralText(sourceNode as Node) : undefined;
    if (source && moduleMatches(source, hook)) return hook;
    // export { useT } from './x' — need further resolution; handled by resolveExternal on caller.
    if (source && !NEXT_INTL_MODULES.has(source)) {
      // Try definition of the name in the export source file via semantic on the name field.
      if (nameNode) {
        const inner = safeDefinition(nameNode as Node, true);
        if (inner) {
          const fromInner = hookKindFromExportNode(inner.node);
          if (fromInner) return fromInner;
          return resolveHookIdentifier(nameNode as Node, 7)?.hook ?? null;
        }
      }
    }
    return null;
  }

  // export { useTranslations } from 'next-intl' — name is the identifier
  const exportStmt = node.ancestors().find((a) => a.kind() === 'export_statement');
  if (exportStmt) {
    const source = stringLiteralText(exportStmt.field('source') as Node | null);
    const text = node.kind() === 'identifier' ? node.text() : node.field('name')?.text();
    if (source && text && isNextIntlHookName(text) && moduleMatches(source, hookKindForImportName(text))) {
      return hookKindForImportName(text);
    }
  }

  return null;
}

function findExportedHookKind(node: Node, importedName: string): HookKind | null {
  if (isNextIntlHookName(importedName)) {
    const from = hookKindFromExportNode(node);
    if (from) return from;
  }
  // Search export specifiers in the same file for matching local/alias.
  const root = node.getRoot().root();
  for (const spec of root.findAll({rule: {kind: 'export_specifier'}}) as Node[]) {
    const name = spec.field('name')?.text();
    const alias = spec.field('alias')?.text();
    const local = alias ?? name;
    if (local !== importedName && name !== importedName) continue;
    if (name && isNextIntlHookName(name)) {
      const stmt = spec.ancestors().find((a) => a.kind() === 'export_statement');
      const source = stringLiteralText(stmt?.field('source') as Node | null);
      const hook = hookKindForImportName(name);
      if (source && moduleMatches(source, hook)) return hook;
      if (source && !NEXT_INTL_MODULES.has(source) && name) {
        const n = spec.field('name');
        if (n) {
          const inner = resolveHookIdentifier(n as Node, 6);
          if (inner) return inner.hook;
        }
      }
    }
  }
  return null;
}

function hookKindFromRequireBinding(defined: Node, localName: string): HookKind | null {
  // const { useTranslations } = require('next-intl')
  // const { useTranslations: useT } = require('next-intl')
  let declarator: Node | null =
    defined.kind() === 'variable_declarator'
      ? defined
      : defined.ancestors().find((a) => a.kind() === 'variable_declarator') ?? null;
  if (!declarator && defined.kind() === 'identifier') {
    declarator = defined.parent()?.kind() === 'variable_declarator' ? (defined.parent() as Node) : null;
  }
  if (!declarator) return null;
  const value = unwrap(declarator.field('value') as Node | null);
  if (!value || value.kind() !== 'call_expression') return null;
  const fn = value.field('function');
  if (fn?.kind() !== 'identifier' || fn.text() !== 'require') return null;
  const args = value.field('arguments');
  const argNode =
    (args?.children().filter((c) => c.isNamed())[0] as Node | undefined) ?? null;
  const mod = stringLiteralText(argNode);
  if (!mod || !NEXT_INTL_MODULES.has(mod)) return null;

  const nameNode = declarator.field('name');
  if (!nameNode) return null;
  if (nameNode.kind() === 'object_pattern') {
    for (const prop of nameNode.children().filter((c) => c.isNamed()) as Node[]) {
      // shorthands / pair_pattern
      if (prop.kind() === 'shorthand_property_identifier_pattern') {
        const n = prop.text();
        if (n === localName && isNextIntlHookName(n) && moduleMatches(mod, hookKindForImportName(n))) {
          return hookKindForImportName(n);
        }
      }
      if (prop.kind() === 'pair_pattern' || prop.kind() === 'object_assignment_pattern') {
        const key = prop.field('key') ?? prop.child(0);
        const val = prop.field('value') ?? prop.child(2);
        const imported = key?.text();
        const local = val?.text() ?? imported;
        if (local === localName && imported && isNextIntlHookName(imported) && moduleMatches(mod, hookKindForImportName(imported))) {
          return hookKindForImportName(imported);
        }
      }
    }
  }
  return null;
}

function positionOf(node: Node, source: string): {line: number; column: number} {
  const start = node.range().start;
  // Prefer byte index → code-point column on the line (matches SWC extractor).
  const index = typeof start.index === 'number' ? start.index : null;
  if (index !== null) {
    const before = source.slice(0, index);
    const line = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    const column = [...source.slice(lineStart, index)].length;
    return {line, column};
  }
  return {line: start.line + 1, column: start.column};
}

function rangeOf(node: Node): {start: number; end: number} {
  const r = node.range();
  return {start: r.start.index, end: r.end.index};
}

function staticPropertyNames(node: Node | null | undefined): string[] | undefined {
  if (!node || node.kind() !== 'object') return undefined;
  const names: string[] = [];
  for (const prop of node.children().filter((c) => c.isNamed()) as Node[]) {
    if (prop.kind() === 'pair') {
      const key = prop.field('key');
      if (!key || (key.kind() !== 'property_identifier' && key.kind() !== 'string' && key.kind() !== 'identifier')) {
        return undefined;
      }
      names.push(key.kind() === 'string' ? (stringLiteralText(key) ?? key.text()) : key.text());
    } else if (prop.kind() === 'shorthand_property_identifier') {
      names.push(prop.text());
    } else {
      return undefined;
    }
  }
  return names;
}

function parseHookArgs(call: Node): {
  namespace?: string;
  otherHookProps?: string[];
  problems: Problem[];
  position: {line: number; column: number};
} {
  const source = call.getRoot().source();
  const position = positionOf(call, source);
  const problems: Problem[] = [];
  const args = call.field('arguments');
  const argList = args?.children().filter((c) => c.isNamed()) as Node[] | undefined;
  const arg = argList?.[0];
  if (!arg) return {problems, position};

  if (arg.kind() === 'object') {
    const otherHookProps: string[] = [];
    let namespace: string | undefined;
    for (const prop of arg.children().filter((c) => c.isNamed()) as Node[]) {
      if (prop.kind() !== 'pair') {
        otherHookProps.push(prop.text());
        continue;
      }
      const key = prop.field('key');
      const keyText = key?.text();
      if (keyText === 'namespace') {
        const value = prop.field('value') as Node | null;
        const ns = stringLiteralText(value);
        if (ns === undefined) problems.push({reason: 'dynamic-namespace', ...position});
        namespace = ns;
      } else {
        otherHookProps.push(prop.text());
      }
    }
    return {namespace, otherHookProps, problems, position};
  }

  const namespace = stringLiteralText(arg);
  if (namespace === undefined) problems.push({reason: 'dynamic-namespace', ...position});
  return {namespace, problems, position};
}

function findBindingName(call: Node): {name: string; nameNode: Node} | null {
  let node: Node = call;
  const parent = node.parent();
  if (parent?.kind() === 'await_expression') node = parent;

  // const t = useTranslations()
  const decl = node.parent();
  if (decl?.kind() === 'variable_declarator') {
    const name = decl.field('name');
    if (name?.kind() === 'identifier') return {name: name.text(), nameNode: name};
  }

  // const [a, b] = await Promise.all([getTranslations('a'), getTranslations('b')])
  if (node.parent()?.kind() === 'array') {
    const array = node.parent()!;
    const elements = array.children().filter((c) => c.isNamed());
    const index = elements.findIndex((el) => el.id() === node.id() || el.id() === call.id());
    // Walk up to Promise.all call → await → declarator
    let cursor: Node | null = array.parent();
    if (cursor?.kind() === 'arguments') cursor = cursor.parent();
    if (cursor?.kind() === 'call_expression') {
      let outer: Node | null = cursor.parent();
      if (outer?.kind() === 'await_expression') outer = outer.parent();
      if (outer?.kind() === 'variable_declarator') {
        const pattern = outer.field('name');
        if (pattern?.kind() === 'array_pattern') {
          const binds = pattern.children().filter((c) => c.isNamed());
          const el = binds[index];
          if (el?.kind() === 'identifier') return {name: el.text(), nameNode: el};
          // required_parameter / pattern variants
          const id = el?.find({rule: {kind: 'identifier'}});
          if (id) return {name: id.text(), nameNode: id as Node};
        }
      }
    }
  }
  return null;
}

function isHookDependency(reference: Node): boolean {
  // reference inside trailing array arg of useXxx(...)
  const array = reference.parent();
  if (array?.kind() !== 'array') return false;
  const call = array.parent()?.kind() === 'arguments' ? array.parent()!.parent() : array.parent();
  if (call?.kind() !== 'call_expression') return false;
  const args = call.field('arguments');
  const named = args?.children().filter((c) => c.isNamed()) ?? [];
  if (named[named.length - 1]?.id() !== array.id()) return false;
  const fn = call.field('function');
  const name =
    fn?.kind() === 'identifier'
      ? fn.text()
      : fn?.kind() === 'member_expression'
        ? fn.field('property')?.text()
        : '';
  return !!name && /^use[A-Z]/.test(name);
}

function classifyTranslatorUse(
  reference: Node,
  nameNode: Node,
  source: string
): {call?: CallSiteFinding; problem?: Problem} | 'skip' {
  if (reference.id() === nameNode.id()) return 'skip';
  const pos = positionOf(reference, source);

  // t('key')
  const parent = reference.parent();
  if (parent?.kind() === 'call_expression' && parent.field('function')?.id() === reference.id()) {
    return callSiteFromCall(parent, 'call', source, pos);
  }

  // t.rich / t.markup / t.has / t.raw
  if (parent?.kind() === 'member_expression' && parent.field('object')?.id() === reference.id()) {
    const prop = parent.field('property')?.text() ?? '';
    const call = parent.parent();
    if (call?.kind() === 'call_expression' && call.field('function')?.id() === parent.id()) {
      if (prop === 'rich' || prop === 'markup' || prop === 'has' || prop === 'raw') {
        return callSiteFromCall(call, prop, source, pos);
      }
    }
  }

  // t['rich'](...)
  if (parent?.kind() === 'subscript_expression' && parent.field('object')?.id() === reference.id()) {
    const index = parent.field('index');
    const prop = stringLiteralText(index as Node | null);
    const call = parent.parent();
    if (
      call?.kind() === 'call_expression' &&
      call.field('function')?.id() === parent.id() &&
      (prop === 'rich' || prop === 'markup' || prop === 'has' || prop === 'raw')
    ) {
      return callSiteFromCall(call, prop, source, pos);
    }
  }

  // Alias assignment: const tr = t  → follow tr's references separately (handled by collecting aliases)
  if (parent?.kind() === 'variable_declarator' && parent.field('value')?.id() === reference.id()) {
    return 'skip';
  }

  if (isHookDependency(reference)) return 'skip';
  return {problem: {reason: 'translator-used-outside-call', ...pos}};
}

function callSiteFromCall(
  call: Node,
  method: CallMethod,
  source: string,
  referencePos: {line: number; column: number}
): {call?: CallSiteFinding; problem?: Problem} {
  if (method === 'has' || method === 'raw') {
    return {problem: {reason: `t.${method}-not-supported-by-extraction`, ...referencePos}};
  }

  // Optional chaining: t?.() or t.rich?.()
  const fn = call.field('function');
  const callText = call.text();
  if (callText.includes('?.') || fn?.text().includes('?.')) {
    return {problem: {reason: 'optional-call-not-supported-by-extraction', ...referencePos}};
  }

  const args = call.field('arguments')?.children().filter((c) => c.isNamed()) as Node[] | undefined;
  const keyNode = args?.[0];
  const key = stringLiteralText(keyNode ?? null);
  if (key === undefined) {
    return {problem: {reason: 'dynamic-key', ...referencePos}};
  }
  const argRange = rangeOf(keyNode!);
  const callPos = positionOf(call, source);
  return {
    call: {
      method,
      key,
      argStart: argRange.start,
      argEnd: argRange.end,
      valueKeys: staticPropertyNames(args?.[1] ?? null),
      line: callPos.line,
      column: callPos.column
    }
  };
}

function collectAliasRoots(nameNode: Node): Node[] {
  const roots: Node[] = [nameNode];
  for (const fileRefs of safeReferences(nameNode)) {
    for (const ref of fileRefs.nodes as Node[]) {
      const parent = ref.parent();
      if (parent?.kind() === 'variable_declarator' && parent.field('value')?.id() === ref.id()) {
        const aliasName = parent.field('name');
        if (aliasName?.kind() === 'identifier') roots.push(aliasName);
      }
    }
  }
  return roots;
}

function collectCallsForBinding(
  nameNode: Node,
  source: string
): {calls: CallSiteFinding[]; problems: Problem[]} {
  const calls: CallSiteFinding[] = [];
  const problems: Problem[] = [];
  const seen = new Set<number>();

  for (const root of collectAliasRoots(nameNode)) {
    for (const fileRefs of safeReferences(root)) {
      for (const ref of fileRefs.nodes as Node[]) {
        if (seen.has(ref.id())) continue;
        seen.add(ref.id());
        const result = classifyTranslatorUse(ref, root, source);
        if (result === 'skip') continue;
        if (result.problem) problems.push(result.problem);
        if (result.call) calls.push(result.call);
      }
    }
  }
  return {calls, problems};
}

function getCallee(call: Node): Node | null {
  return (call.field('function') as Node | null) ?? null;
}

/**
 * Mine one source file for next-intl translation hook bindings.
 */
export function mineFile(root: SgRoot<TSX>): FileFindings {
  const program = root.root();
  const file = root.filename();
  const source = root.source();
  const bindings: BindingFinding[] = [];
  const seenCalls = new Set<number>();

  const calls = program.findAll({rule: {kind: 'call_expression'}}) as Node[];
  for (const call of calls) {
    const callee = getCallee(call);
    if (!callee) continue;
    const resolved = resolveHookKind(callee);
    if (!resolved) continue;
    if (seenCalls.has(call.id())) continue;
    seenCalls.add(call.id());
    const {hook, importSource} = resolved;

    const hookRange = rangeOf(call);
    const parsed = parseHookArgs(call);
    const problems = [...parsed.problems];
    const namespaceObjectText =
      callee.kind() === 'member_expression' ? callee.field('object')?.text() : undefined;
    const bound = findBindingName(call);
    if (!bound) {
      problems.push({reason: 'hook-result-not-bound-to-variable', ...parsed.position});
      bindings.push({
        file,
        name: '',
        hook,
        hookCallStart: hookRange.start,
        hookCallEnd: hookRange.end,
        namespace: parsed.namespace,
        otherHookProps: parsed.otherHookProps,
        namespaceObjectText,
        importSource,
        calls: [],
        problems
      });
      continue;
    }

    const {calls: callSites, problems: useProblems} = collectCallsForBinding(bound.nameNode, source);
    problems.push(...useProblems);

    bindings.push({
      file,
      name: bound.name,
      hook,
      hookCallStart: hookRange.start,
      hookCallEnd: hookRange.end,
      namespace: parsed.namespace,
      otherHookProps: parsed.otherHookProps,
      namespaceObjectText,
      importSource,
      calls: callSites,
      problems
    });
  }

  // Detect files that mention the hook names but we resolved no bindings (e.g. wrong module).
  const mentionsHooks =
    /\buseTranslations\b/.test(source) ||
    /\bgetTranslations\b/.test(source) ||
    bindings.length > 0;
  const unresolvedHookMentions = mentionsHooks && bindings.length === 0;

  return {file, bindings, unresolvedHookMentions};
}
