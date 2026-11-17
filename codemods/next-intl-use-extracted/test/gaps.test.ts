/**
 * Locks the eight hand-rolled CLI gap cases as JSSG fixtures under `tests/gap-*`,
 * plus the ICU-escaped-brace parser behavior.
 */
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {icuNames} from '../scripts/lib/icu.ts';

const toolkitTests = path.resolve(import.meta.dirname, '../tests');

const GAP_CASES = [
  'gap-namespace-import',
  'gap-hook-alias',
  'gap-rebound-translator',
  'gap-computed-rich',
  'gap-barrel-reexport',
  'gap-require',
  'gap-icu-escaped',
  'gap-renamed-reexport'
] as const;

describe('toolkit gap fixtures', () => {
  for (const name of GAP_CASES) {
    it(`ships fixture ${name}`, () => {
      const dir = path.join(toolkitTests, name);
      expect(fs.existsSync(dir)).toBe(true);
      const hasInput =
        fs.existsSync(path.join(dir, 'input.tsx')) || fs.existsSync(path.join(dir, 'input'));
      const hasExpected =
        fs.existsSync(path.join(dir, 'expected.tsx')) || fs.existsSync(path.join(dir, 'expected'));
      expect(hasInput && hasExpected).toBe(true);
    });
  }

  it('does not treat ICU-escaped braces as placeholders', () => {
    const {args} = icuNames("Use '{name}' as written");
    expect([...args]).toEqual([]);
  });
});
