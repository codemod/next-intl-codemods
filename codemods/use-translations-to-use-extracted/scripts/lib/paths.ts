import path from 'node:path';
import {ARTIFACT_DIR, FINDINGS_FILE, PLAN_FILE, REPORT_FILE} from './types.ts';

export function artifactDir(projectRoot: string): string {
  return path.join(projectRoot, ARTIFACT_DIR);
}

export function findingsPath(projectRoot: string): string {
  return path.join(artifactDir(projectRoot), FINDINGS_FILE);
}

export function planPath(projectRoot: string): string {
  return path.join(artifactDir(projectRoot), PLAN_FILE);
}

export function reportPath(projectRoot: string): string {
  return path.join(artifactDir(projectRoot), REPORT_FILE);
}

export function relativePosix(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file).split(path.sep).join('/');
}
