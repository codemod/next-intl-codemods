export type HookKind = 'use' | 'get';

export type CallMethod = 'call' | 'rich' | 'markup' | 'has' | 'raw';

export type NamespaceStrategy = 'none' | 'first-segment' | 'keep';

export type CatalogFormat = 'po' | 'json';

export type Problem = {reason: string; line: number; column: number};

export type CallSiteFinding = {
  method: CallMethod;
  key?: string;
  /** Byte offsets of the first argument (key / message slot). */
  argStart: number;
  argEnd: number;
  valueKeys?: string[];
  line: number;
  column: number;
};

export type BindingFinding = {
  file: string;
  name: string;
  hook: HookKind;
  hookCallStart: number;
  hookCallEnd: number;
  namespace?: string;
  /** Non-namespace object-form props as source text (e.g. `locale`). */
  otherHookProps?: string[];
  calls: CallSiteFinding[];
  problems: Problem[];
  /**
   * When the hook was called as `intl.useTranslations(...)`, the object text (`intl`).
   * Apply rewrites to `intl.useExtracted(...)`.
   */
  namespaceObjectText?: string;
  /** Module specifier of the import that provided the hook (`next-intl` or a local barrel). */
  importSource?: string;
};

export type FileFindings = {
  file: string;
  bindings: BindingFinding[];
  /** True when the file references the old hooks but not via a resolvable next-intl origin. */
  unresolvedHookMentions: boolean;
};

export type FindingsFile = {
  files: Record<string, FileFindings>;
};

export type Reference = {path: string; line: number; column: number};

export type PlannedMessage = {
  id: string;
  message: string;
  references: Reference[];
  translations: Record<string, string>;
  explicitId: boolean;
  oldKeys: string[];
};

export type HookRewrite = {
  hookCallStart: number;
  hookCallEnd: number;
  hook: HookKind;
  namespace?: string;
  otherHookProps?: string[];
  namespaceObjectText?: string;
};

export type CallRewrite = {
  argStart: number;
  argEnd: number;
  replacement: string;
};

export type FilePlan = {
  file: string;
  /** Keep old hook import (some bindings skipped). */
  keepOldHook: Record<HookKind, boolean>;
  convertHook: Record<HookKind, boolean>;
  /** Preferred module path for adding/removing the extracted import per hook. */
  importSourceByHook: Partial<Record<HookKind, string>>;
  /** Original imported name when it was a rename (e.g. useT). */
  oldLocalByHook: Partial<Record<HookKind, string>>;
  hookRewrites: HookRewrite[];
  callRewrites: CallRewrite[];
};

export type ApplyPlan = {
  projectRoot: string;
  sourceLocale: string;
  namespace: NamespaceStrategy;
  format: CatalogFormat;
  outDir: string;
  files: FilePlan[];
  messages: PlannedMessage[];
  keyMap: Record<string, string>;
  report: Report;
};

export type Report = {
  files: {
    scanned: number;
    changed: number;
    withoutNextIntlImport: string[];
  };
  bindings: {converted: number; skipped: number};
  calls: {converted: number};
  messages: {total: number; explicitIds: number};
  normalizedKeys: string[];
  valuesNotInMessage: Array<{
    file: string;
    line: number;
    column: number;
    key: string;
    values: string[];
  }>;
  skipped: Array<{
    file: string;
    name: string;
    hook: HookKind;
    line: number;
    column: number;
    problems: Problem[];
  }>;
  conflicts: Array<{
    namespace?: string;
    message: string;
    clusters: Array<{id: string; oldKeys: string[]; translations: Record<string, string>}>;
  }>;
  nonStringKeys: string[];
  catalogCollisions: Array<{locale: string; key: string; files: [string, string]}>;
  unreferencedKeys: string[];
  keyMap: Record<string, string>;
};

export const EXTRACTED_BY_HOOK: Record<HookKind, string> = {
  use: 'useExtracted',
  get: 'getExtracted',
};

export const MODULE_BY_HOOK: Record<HookKind, string> = {
  use: 'next-intl',
  get: 'next-intl/server',
};

export const HOOK_BY_IMPORT: Record<string, HookKind> = {
  useTranslations: 'use',
  getTranslations: 'get',
};

export const ARTIFACT_DIR = '.codemod-next-intl';
export const FINDINGS_FILE = 'findings.json';
export const PLAN_FILE = 'plan.json';
export const REPORT_FILE = 'report.json';
