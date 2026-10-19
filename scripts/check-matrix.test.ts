import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without types
import { checkMatrix, parseCsv } from './check-matrix.mjs';

const csv = 'id,ours,evidence,note\r\na,built,src/a.ts:12,"has, comma and ""quote"""\r\nb,built,"src/b.ts","line one\nline two"\r\nc,partial,src/missing.ts,x\r\nd,built,,\r\n';

describe('parseCsv', () => {
  it('keeps quoted commas, escaped quotes and multi-line cells in one row', () => {
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0].note).toBe('has, comma and "quote"');
    expect(rows[1].note).toBe('line one\nline two');
  });
});

describe('checkMatrix', () => {
  it('checks only built rows and strips the line suffix', () => {
    const seen: string[] = [];
    const results = checkMatrix(parseCsv(csv), (p: string) => (seen.push(p), p === 'src/a.ts' || p === 'src/b.ts'));
    expect(results.map((r: { id: string; ok: boolean }) => [r.id, r.ok])).toEqual([['a', true], ['b', true], ['d', false]]);
    expect(seen).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('fails a built row whose evidence does not exist', () => {
    const [r] = checkMatrix(parseCsv('id,ours,evidence\nx,built,src/gone.ts:3\n'), () => false);
    expect(r.ok).toBe(false);
  });

  it('checks every path in a semicolon-separated evidence cell', () => {
    const seen: string[] = [];
    const exists = (p: string) => (seen.push(p), p !== 'e2e/gone.spec.ts');
    const [both, one] = checkMatrix(parseCsv('id,ours,evidence\nx,built,e2e/a.spec.ts; e2e/b.spec.ts:4\ny,built,e2e/a.spec.ts; e2e/gone.spec.ts\n'), exists);
    expect([both.ok, one.ok]).toEqual([true, false]);
    expect(seen).toEqual(['e2e/a.spec.ts', 'e2e/b.spec.ts', 'e2e/a.spec.ts', 'e2e/gone.spec.ts']);
  });
});
