import pg, { type CustomTypesConfig } from 'pg';

// The type mapping from ADR 0001 (Consequences). Every pool and test client passes `pgTypes`, so the store reads
// the same JS shapes the SQLite store returns today: numbers for money and rates, strings for dates and times.

export function parseBigint(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint ${text} is outside the safe integer range of a JS number`);
  return value;
}

export function parseNumeric(text: string): number {
  return Number(text);
}

export function parseDate(text: string): string {
  return text;
}

const parseTimestampToDate = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
export function parseTimestamptz(text: string): string {
  return (parseTimestampToDate(text) as Date).toISOString();
}

const parsers: Partial<Record<number, (text: string) => unknown>> = {
  [pg.types.builtins.INT8]: parseBigint,
  [pg.types.builtins.NUMERIC]: parseNumeric,
  [pg.types.builtins.DATE]: parseDate,
  [pg.types.builtins.TIMESTAMPTZ]: parseTimestamptz,
};

export const pgTypes = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') => parsers[oid] ?? pg.types.getTypeParser(oid, format),
} as CustomTypesConfig;
