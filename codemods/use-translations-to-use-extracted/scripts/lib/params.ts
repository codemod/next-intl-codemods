import type {CatalogFormat, NamespaceStrategy} from './types.ts';

export type CodemodParams = {
  messages: string;
  sourceLocale: string;
  out: string;
  format: CatalogFormat;
  namespace: NamespaceStrategy;
};

export function readParams(raw: unknown): CodemodParams {
  const p = (raw ?? {}) as Record<string, unknown>;
  const messages = String(p.messages ?? process.env.NEXT_INTL_MESSAGES ?? '');
  const sourceLocale = String(p.sourceLocale ?? process.env.NEXT_INTL_SOURCE_LOCALE ?? '');
  const out = String(p.out ?? process.env.NEXT_INTL_OUT ?? 'messages');
  const format = String(p.format ?? process.env.NEXT_INTL_FORMAT ?? 'po') as CatalogFormat;
  const namespace = String(
    p.namespace ?? process.env.NEXT_INTL_NAMESPACE ?? 'none'
  ) as NamespaceStrategy;

  if (!messages) throw new Error('Missing required param: messages');
  if (!sourceLocale) throw new Error('Missing required param: sourceLocale');
  if (format !== 'po' && format !== 'json') throw new Error(`Unknown format: ${format}`);
  if (namespace !== 'none' && namespace !== 'first-segment' && namespace !== 'keep') {
    throw new Error(`Unknown namespace strategy: ${namespace}`);
  }
  return {messages, sourceLocale, out, format, namespace};
}

/**
 * Defaults used by jssg fixtures (catalogs under messages/).
 * `out: '__skip__'` builds the apply plan without writing catalog files
 * (keeps directory/file fixtures focused on source transforms).
 */
export function fixtureParams(overrides: Partial<CodemodParams> = {}): CodemodParams {
  return {
    messages: 'messages/{locale}.json',
    sourceLocale: 'en',
    out: '__skip__',
    format: 'po',
    namespace: 'none',
    ...overrides
  };
}
