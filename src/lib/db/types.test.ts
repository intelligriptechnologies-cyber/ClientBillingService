import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { pgTypes } from './types';

const parse = (oid: number, text: string) => (pgTypes.getTypeParser(oid, 'text') as (value: string) => unknown)(text);
const { INT8, NUMERIC, DATE, TIMESTAMPTZ, INT4 } = pg.types.builtins;

describe('pgTypes', () => {
  it('reads bigint money as a number and refuses values a number cannot hold exactly', () => {
    expect(parse(INT8, '118000')).toBe(118000);
    expect(parse(INT8, '-25000')).toBe(-25000);
    expect(parse(INT8, String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => parse(INT8, '9007199254740992')).toThrow(RangeError);
    expect(() => parse(INT8, '-9007199254740992')).toThrow(RangeError);
  });

  it('reads numeric rates as numbers', () => {
    expect(parse(NUMERIC, '18.000')).toBe(18);
    expect(parse(NUMERIC, '2.125')).toBe(2.125);
  });

  it('keeps dates as YYYY-MM-DD strings with no time zone shift', () => {
    expect(parse(DATE, '2026-10-01')).toBe('2026-10-01');
  });

  it('reads timestamptz as an ISO string in UTC', () => {
    expect(parse(TIMESTAMPTZ, '2026-10-01 09:00:00+00')).toBe('2026-10-01T09:00:00.000Z');
    expect(parse(TIMESTAMPTZ, '2026-10-01 14:30:00.123+05:30')).toBe('2026-10-01T09:00:00.123Z');
  });

  it('leaves other types to the pg defaults', () => {
    expect(parse(INT4, '42')).toBe(42);
  });
});
