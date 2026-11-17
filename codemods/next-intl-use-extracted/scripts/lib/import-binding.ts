/**
 * Minimal importBindingOf (same contract as @jssg/utils/javascript/bindings).
 * Vendored so the JSSG runtime does not need the unpublished bindings subpath.
 */
import type {SgNode} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';

type Node = SgNode<TSX>;

export interface ImportBinding {
  importedName: string;
  localName: string;
  source: string;
}

function safeDefinition(node: Node, resolveExternal = true) {
  try {
    return node.definition({resolveExternal});
  } catch {
    return null;
  }
}

function asSpecifier(node: Node): Node | null {
  if (node.kind() === 'import_specifier') return node;
  const parent = node.parent();
  if (parent?.kind() === 'import_specifier') return parent;
  return null;
}

function moduleSource(node: Node): string | null {
  const statement =
    node.kind() === 'import_statement'
      ? node
      : node.ancestors().find((ancestor) => ancestor.kind() === 'import_statement');
  const sourceNode = statement?.field('source');
  if (!sourceNode) return null;
  const fragments = sourceNode.findAll({rule: {kind: 'string_fragment'}});
  if (fragments.length === 0) return null;
  return fragments.map((fragment) => fragment.text()).join('');
}

function readNamedSpecifier(specifier: Node): ImportBinding | null {
  const nameNode = specifier.field('name');
  if (!nameNode) return null;
  const source = moduleSource(specifier);
  if (source === null) return null;
  const alias = specifier.field('alias');
  return {
    importedName: nameNode.text(),
    localName: alias ? alias.text() : nameNode.text(),
    source
  };
}

function bindingInStatement(statement: Node, localName: string): ImportBinding | null {
  const source = moduleSource(statement);
  if (source === null) return null;

  for (const specifier of statement.findAll({rule: {kind: 'import_specifier'}})) {
    const nameNode = specifier.field('name');
    const alias = specifier.field('alias');
    const local = alias ?? nameNode;
    if (!nameNode || local?.text() !== localName) continue;
    return {importedName: nameNode.text(), localName, source};
  }

  const clause = statement.find({rule: {kind: 'import_clause'}});
  if (!clause) return null;

  for (const child of clause.children()) {
    if (child.kind() === 'identifier' && child.text() === localName) {
      return {importedName: 'default', localName, source};
    }
    if (child.kind() === 'namespace_import') {
      const identifier = child.children().find((inner) => inner.kind() === 'identifier');
      if (identifier?.text() === localName) {
        return {importedName: '*', localName, source};
      }
    }
  }

  return null;
}

function bindingFromDefinedNode(defined: Node, localNameHint: string): ImportBinding | null {
  const specifier = asSpecifier(defined);
  if (specifier) return readNamedSpecifier(specifier);

  if (defined.kind() === 'identifier') {
    const parent = defined.parent();
    const source = moduleSource(defined);
    if (source !== null && parent?.kind() === 'namespace_import') {
      return {importedName: '*', localName: defined.text(), source};
    }
    if (source !== null && parent?.kind() === 'import_clause') {
      return {importedName: 'default', localName: defined.text(), source};
    }
  }

  const statement =
    defined.kind() === 'import_statement'
      ? defined
      : defined.ancestors().find((ancestor) => ancestor.kind() === 'import_statement');
  if (!statement) return null;
  return bindingInStatement(statement, localNameHint);
}

/**
 * Prefer a same-file import statement match. Semantic `definition()` can jump to a
 * re-export in another file even with `resolveExternal: false`, which loses the
 * local module specifier (needed for barrel / renamed re-export consumers).
 */
function importBindingLexical(node: Node): ImportBinding | null {
  if (node.kind() !== 'identifier') return null;
  const localName = node.text();
  const root = node.getRoot().root();
  for (const statement of root.findAll({rule: {kind: 'import_statement'}}) as Node[]) {
    const binding = bindingInStatement(statement, localName);
    if (binding) return binding;
  }
  return null;
}

export function importBindingOf(node: SgNode<TSX>): ImportBinding | null {
  const current = node as Node;
  const lexical = importBindingLexical(current);
  if (lexical) return lexical;

  const definition = safeDefinition(current, false);
  if (!definition) return null;
  return bindingFromDefinedNode(definition.node, current.text());
}
