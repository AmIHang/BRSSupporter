import type { BrowserContext } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { takeOverTicket } from '../src/takeover.js';

/** GET /personal/api/indication/<n> as BSM answers it (shape seen 2026-11-18). */
const answer = (status: string) => ({
  Indication: { Number: 'STBBRSg0041', Status: status },
  Users: [],
});

/** Records whether the UI was touched; the page itself is never driven in tests. */
function fakeCtx() {
  const opened: string[] = [];
  const ctx = {
    newPage: async () => {
      opened.push('page');
      throw new Error('stop: no UI in tests');
    },
  } as unknown as BrowserContext;
  return { ctx, opened };
}

describe('takeOverTicket', () => {
  it('reads the status from the wrapped answer and only then opens the ticket', async () => {
    const { ctx, opened } = fakeCtx();
    await expect(takeOverTicket(async () => answer('new'), ctx, 'STBBRSg0041')).rejects.toThrow(
      'stop: no UI in tests',
    );
    expect(opened).toEqual(['page']);
  });

  it('touches nothing when BSM no longer shows the ticket as new', async () => {
    const { ctx, opened } = fakeCtx();
    await expect(
      takeOverTicket(async () => answer('inprocess'), ctx, 'STBBRSg0041'),
    ).rejects.toThrow('nicht mehr neu (Status in BSM: inprocess)');
    await expect(takeOverTicket(async () => ({}), ctx, 'STBBRSg0041')).rejects.toThrow(
      'nicht mehr neu',
    );
    await expect(takeOverTicket(async () => answer('new'), ctx, '../x')).rejects.toThrow(
      'Ungültige Ticketnummer',
    );
    expect(opened).toEqual([]);
  });
});
