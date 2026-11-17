/**
 * Pass 1: mine translation bindings into workflow state.
 * Findings are kept in memory/state only during the scan — flushed to disk once
 * when the apply step builds the plan (avoids O(n²) JSON rewrites).
 */
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {useMetricAtom} from 'codemod:metrics';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {mineFile} from './lib/mine-ast.ts';
import {projectRootFromOptions} from './lib/project-root.ts';
import {FINDINGS_STATE} from './lib/state-keys.ts';
import type {FindingsFile} from './lib/types.ts';

const mined = useMetricAtom('next_intl_binding_mined');

function metricPath(filename: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filename);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : filename;
}

const transform: Transform<TSX> = async (root, options) => {
  const findings = mineFile(root);
  const file = root.filename();
  const projectRoot = projectRootFromOptions(options, file);
  const fileKey = metricPath(file, projectRoot);

  for (const binding of findings.bindings) {
    mined.increment({
      file: fileKey,
      hook: binding.hook,
      outcome: binding.problems.length > 0 ? 'problem' : 'ok'
    });
  }

  // No bindings and no unresolved mentions: skip state write.
  if (findings.bindings.length === 0 && !findings.unresolvedHookMentions) {
    return null;
  }

  const release = acquireLock(FINDINGS_STATE);
  try {
    const existing = (getState<FindingsFile>(FINDINGS_STATE) ?? {files: {}}) as FindingsFile;
    existing.files[file] = findings;
    // Persist so the apply step (next workflow node) can read findings.
    setState(FINDINGS_STATE, existing, true);
  } finally {
    release();
  }

  return null;
};

export default transform;
