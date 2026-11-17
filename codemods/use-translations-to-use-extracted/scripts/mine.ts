/**
 * Pass 1: mine translation bindings.
 *
 * Dry-run does not persist `codemod:workflow` state across steps, so findings
 * are always written to `.codemod-next-intl/findings.json` for the apply handoff.
 */
import fs from 'node:fs';
import path from 'node:path';
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {useMetricAtom} from 'codemod:metrics';
import {acquireLock, getState, setState} from 'codemod:workflow';
import {mineFile} from './lib/mine-ast.ts';
import {artifactDir, findingsPath, planPath, reportPath} from './lib/paths.ts';
import {projectRootFromOptions} from './lib/project-root.ts';
import {FINDINGS_STATE} from './lib/state-keys.ts';
import type {FindingsFile} from './lib/types.ts';

const mined = useMetricAtom('next_intl_binding_mined');

function metricPath(filename: string, projectRoot: string): string {
  const rel = path.relative(projectRoot, filename);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : filename;
}

function invalidatePlanArtifacts(projectRoot: string) {
  for (const file of [planPath(projectRoot), reportPath(projectRoot)]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // ignore missing
    }
  }
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

  if (findings.bindings.length === 0 && !findings.unresolvedHookMentions) {
    return null;
  }

  const release = acquireLock(FINDINGS_STATE);
  try {
    // In-step state works under dry-run; cross-step persistence does not.
    const fromState = getState<FindingsFile>(FINDINGS_STATE);
    let existing: FindingsFile;
    if (fromState) {
      existing = fromState;
    } else {
      // First write in this mine pass: ignore stale disk artifacts from a previous run.
      invalidatePlanArtifacts(projectRoot);
      existing = {files: {}};
    }
    existing.files[file] = findings;
    setState(FINDINGS_STATE, existing, true);

    fs.mkdirSync(artifactDir(projectRoot), {recursive: true});
    fs.writeFileSync(findingsPath(projectRoot), JSON.stringify(existing));
  } finally {
    release();
  }

  return null;
};

export default transform;
