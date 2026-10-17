import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('GET /api/health', () => {
  it('answers 200 with only { ok: true } and needs no session', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
