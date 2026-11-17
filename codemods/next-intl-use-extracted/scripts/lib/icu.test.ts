import {describe, expect, it} from 'vitest';
import {icuNames} from './icu.ts';

describe('icuNames', () => {
  it('does not treat ICU-escaped braces as placeholders', () => {
    const {args, tags} = icuNames("Use '{name}' as written");
    expect([...args]).toEqual([]);
    expect([...tags]).toEqual([]);
  });

  it('finds real arguments and tags', () => {
    const {args, tags} = icuNames('Hi <b>{name}</b>, {count, plural, one {# item} other {# items}}');
    expect(args.has('name')).toBe(true);
    expect(args.has('count')).toBe(true);
    expect(tags.has('b')).toBe(true);
  });
});
