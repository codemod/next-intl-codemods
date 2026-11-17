/**
 * @deprecated Prefer plan building inside `apply.ts` (mine → apply).
 * Kept as a thin JSSG entry for local debugging if needed.
 */
import type {Transform} from 'codemod:ast-grep';
import type TSX from 'codemod:ast-grep/langs/tsx';
import {ensurePlan} from './lib/ensure-plan.ts';
import {projectRootFromOptions} from './lib/project-root.ts';

const transform: Transform<TSX> = async (_root, options) => {
  ensurePlan({
    targetDir: projectRootFromOptions(options),
    params: options?.params,
    dryRun: options?.dryRun === true
  });
  return null;
};

export default transform;
