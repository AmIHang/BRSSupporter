import { describe, expect, it } from 'vitest';
import { createCore, type BsmFetch } from '../src/index.js';

const clock = { now: () => new Date('2026-11-18T10:00:00Z') };

const ticket = (number: string, changeDate = '2026-11-01T00:00:00Z') => ({
  number,
  summary: `Summary ${number}`,
  status: 'new',
  createDate: '2026-11-01T00:00:00Z',
  changeDate,
  handler: 'gra',
});

/** Fake BSM serving `all` in pages, honouring limit/offset like the real API. */
function fakeBsm(all: unknown[], applications: unknown[] = []) {
  const calls: unknown[] = [];
  const fetch: BsmFetch = async (path, body) => {
    if (path === '/personal/api/application') return { Applications: applications };
    calls.push(body);
    const { limit, offset } = body as { limit: number; offset: number };
    return {
      indications: all.slice(offset, offset + limit),
      users: [{ username: 'gra', name: 'G. R. A.' }],
      limitExceeded: offset + limit < all.length,
    };
  };
  return { fetch, calls };
}

describe('syncBsm', () => {
  it('full: adds, changes and marks gone; a second identical run changes nothing', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const full = { full: true };
    expect(await core.syncBsm(fakeBsm([ticket('A1'), ticket('B2')]).fetch, {}, full)).toEqual({
      mode: 'full',
      added: ['A1', 'B2'],
      changed: [],
      gone: [],
      statusChanged: [],
    });
    const next = fakeBsm([ticket('A1', '2026-11-02T00:00:00Z')]).fetch;
    expect(await core.syncBsm(next, {}, full)).toMatchObject({ changed: ['A1'], gone: ['B2'] });
    expect(await core.syncBsm(next, {}, full)).toMatchObject({ added: [], changed: [], gone: [] });
    expect(core.tickets.list().map((t) => t.number)).toEqual(['A1']);
  });

  it('reports status changes apart from other changes', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const full = { full: true };
    await core.syncBsm(fakeBsm([ticket('A1'), ticket('B2')]).fetch, {}, full);
    const next = fakeBsm([
      { ...ticket('A1', '2026-11-02T00:00:00Z'), status: 'delivered' },
      { ...ticket('B2', '2026-11-02T00:00:00Z'), summary: 'new title' },
    ]).fetch;
    expect(await core.syncBsm(next, {}, full)).toMatchObject({
      changed: ['A1', 'B2'],
      statusChanged: ['A1'],
    });
  });

  it('full: all open tickets, closed ones only changed within 30 days', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const bsm = fakeBsm([ticket('A1')]);
    await core.syncBsm(bsm.fetch, { applicationFilter: 'X' }, { full: true });
    const filters = bsm.calls.map((c) => (c as { filter: unknown }).filter);
    expect(filters).toEqual([
      { applicationFilter: 'X', statusFilter: ['new', 'inprocess'] },
      {
        applicationFilter: 'X',
        statusFilter: ['delivered', 'completed', 'archived'],
        minChangeDateFilter: '2026-10-19T10:00:00.000Z',
      },
    ]);
    // Both answers had A1 (the fake ignores the filter): still one ticket.
    expect(core.tickets.list().map((t) => t.number)).toEqual(['A1']);
  });

  it('pages through limitExceeded', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const bsm = fakeBsm(Array.from({ length: 1201 }, (_, n) => ticket(`T${n}`)));
    const res = await core.syncBsm(bsm.fetch, { statusFilter: ['new'] });
    expect(res.added).toHaveLength(1201);
    expect(bsm.calls).toHaveLength(3);
  });

  it('reads the PascalCase answer BSM really sends', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const res = await core.syncBsm(
      async (path) => ({
        Applications: path.endsWith('/application') ? [] : undefined,
        Indications: [
          {
            Number: 'STBBRSg0039',
            Status: 'inprocess',
            Summary: 'Schnittstellenfehler',
            CreateDate: '2026-11-18T08:27:39Z',
            ChangeDate: '2026-11-18T09:46:27Z',
          },
        ],
        Users: [],
        LimitExceeded: false,
      }),
      {},
    );
    expect(res.added).toEqual(['STBBRSg0039']);
    expect(core.tickets.list()[0]).toMatchObject({
      status: 'inprocess',
      summary: 'Schnittstellenfehler',
    });
  });

  it('treats an answer without indications as an error, not as empty', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    await core.syncBsm(fakeBsm([ticket('A1')]).fetch, {});
    await expect(
      core.syncBsm(
        async (path) =>
          path.endsWith('/application') ? { Applications: [] } : { something: 'else' },
        {},
      ),
    ).rejects.toThrow();
    expect(core.tickets.list()).toHaveLength(1);
  });

  it('stores projects and hides tickets of hidden projects', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const inApp = (n: string, applicationName: string, projectName: string | null) => ({
      ...ticket(n),
      applicationName,
      projectName,
    });
    const bsm = fakeBsm([
      inApp('A1', 'ELL BRS', 'Wartung'),
      inApp('B2', 'STB BRS', 'Wartung'),
      inApp('C3', 'STB BRS', null),
    ]);
    await core.syncBsm(bsm.fetch, {});
    await core.syncBsm(bsm.fetch, {});
    expect(core.projects.list()).toEqual([
      {
        applicationName: 'ELL BRS',
        name: 'Wartung',
        customer: null,
        customerColor: null,
        hidden: false,
      },
      // C3 has no project: pseudo entry with empty name.
      { applicationName: 'STB BRS', name: '', customer: null, customerColor: null, hidden: false },
      {
        applicationName: 'STB BRS',
        name: 'Wartung',
        customer: null,
        customerColor: null,
        hidden: false,
      },
    ]);
    expect(core.projects.setHidden('ELL BRS', 'Wartung', true)).toBe(true);
    expect(core.projects.setHidden('ELL BRS', 'Unbekannt', true)).toBe(false);
    expect(core.tickets.list().map((t) => t.number)).toEqual(['B2', 'C3']);
  });

  it('hides tickets without project as a group of their own', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const apps = [
      { Name: 'ELL BRS', Customer: 'ELL' },
      { Name: 'STB BRS', Customer: 'STB' },
    ];
    const t = (n: string, applicationName: string, projectName: string | null) => ({
      ...ticket(n),
      applicationName,
      projectName,
    });
    const first = [
      t('A1', 'ELL BRS', 'Wartung'),
      t('A2', 'ELL BRS', null),
      t('B1', 'STB BRS', null),
    ];
    await core.syncBsm(fakeBsm(first, apps).fetch, {});

    // Hiding the customer leaves its tickets without project alone.
    core.projects.setCustomerHidden('ELL', true);
    expect(core.tickets.list().map((x) => x.number)).toEqual(['A2', 'B1']);

    // Hiding all "without project" entries: also a new application's one stays hidden.
    core.projects.setHidden('ELL BRS', '', true);
    core.projects.setHidden('STB BRS', '', true);
    expect(core.tickets.list()).toEqual([]);
    const apps2 = [...apps, { Name: 'FLIX BRS', Customer: 'Flix' }];
    await core.syncBsm(fakeBsm([...first, t('C1', 'FLIX BRS', null)], apps2).fetch, {});
    expect(core.tickets.list()).toEqual([]);
  });

  it('hides a whole customer, also its projects that appear later', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    const apps = [
      { Name: 'ELL BRS', ShortName: 'ELLB', Customer: 'ELL' },
      { Name: 'ELL Asset', ShortName: null, Customer: 'ELL' },
      { Name: 'STB BRS', ShortName: 'STBB', Customer: 'STB' },
    ];
    const inProject = (n: string, applicationName: string, projectName: string) => ({
      ...ticket(n),
      applicationName,
      projectName,
    });
    const first = [
      inProject('A1', 'ELL BRS', 'Wartung'),
      inProject('A2', 'ELL Asset', 'Asset'),
      inProject('B1', 'STB BRS', 'Wartung'),
    ];
    await core.syncBsm(fakeBsm(first, apps).fetch, {});
    expect(core.projects.list().map((p) => p.customer)).toEqual(['ELL', 'ELL', 'STB']);

    expect(core.projects.setCustomerHidden('ELL', true)).toBe(true);
    expect(core.projects.setCustomerHidden('Unbekannt', true)).toBe(false);
    expect(core.tickets.list().map((t) => t.number)).toEqual(['B1']);

    // New ELL project: hidden too, because all of ELL is hidden. New STB project stays visible.
    const later = [...first, inProject('A3', 'ELL BRS', 'Neu'), inProject('B2', 'STB BRS', 'Neu')];
    await core.syncBsm(fakeBsm(later, apps).fetch, {});
    expect(core.tickets.list().map((t) => t.number)).toEqual(['B1', 'B2']);

    expect(core.projects.setCustomerHidden('ELL', false)).toBe(true);
    expect(core.tickets.list()).toHaveLength(5);

    // Customer color: null (computed by the app) until set, then on every ticket of the customer.
    expect(core.tickets.list().find((t) => t.number === 'A1')).toMatchObject({
      customer: 'ELL',
      customerColor: null,
    });
    expect(core.projects.setCustomerColor('ELL', '#123abc')).toBe(true);
    expect(core.projects.setCustomerColor('Unbekannt', '#123abc')).toBe(false);
    const colors = core.tickets.list().map((t) => [t.number, t.customerColor]);
    expect(Object.fromEntries(colors)).toMatchObject({ A1: '#123abc', A3: '#123abc', B1: null });
    // A later sync keeps the chosen color.
    await core.syncBsm(fakeBsm(later, apps).fetch, {});
    expect(core.projects.list()[0]!.customerColor).toBe('#123abc');
  });

  it('fetches only the delta after the first run, with buffer and without status filter', async () => {
    let now = new Date('2026-11-18T10:00:00Z');
    const core = createCore({ databaseFile: ':memory:', clock: { now: () => now } });
    const filters: Array<Record<string, unknown>> = [];
    let serve: unknown[] = [];
    const fetch: BsmFetch = async (path, body) => {
      if (path === '/personal/api/application') return { Applications: [] };
      filters.push((body as { filter: Record<string, unknown> }).filter);
      return { Indications: serve, LimitExceeded: false };
    };
    const filter = { statusFilter: ['new' as const, 'inprocess' as const] };

    serve = [ticket('A1'), ticket('B2'), ticket('C3')];
    expect(await core.syncBsm(fetch, filter)).toMatchObject({
      mode: 'full',
      added: ['A1', 'B2', 'C3'],
    });
    expect(filters.at(-1)).toEqual(filter);

    // Delta: B2 changed, C3 was delivered (left the filter), A1 unchanged and not returned.
    now = new Date('2026-11-18T10:15:00Z');
    serve = [
      { ...ticket('B2', '2026-11-18T10:05:00Z'), status: 'inprocess' },
      { ...ticket('C3', '2026-11-18T10:06:00Z'), status: 'delivered' },
    ];
    expect(await core.syncBsm(fetch, filter)).toMatchObject({
      mode: 'delta',
      added: [],
      changed: ['B2'],
      gone: ['C3'],
    });
    // Since the last run (10:00) minus 5 min buffer, no status filter.
    expect(filters.at(-1)).toEqual({ minChangeDateFilter: '2026-11-18T09:55:00.000Z' });
    expect(
      core.tickets
        .list()
        .map((t) => t.number)
        .sort(),
    ).toEqual(['A1', 'B2']);

    // Full on request, and after a filter change.
    serve = [ticket('A1')];
    expect(await core.syncBsm(fetch, filter, { full: true })).toMatchObject({
      mode: 'full',
      gone: ['B2'],
    });
    expect((await core.syncBsm(fetch, { statusFilter: ['new'] })).mode).toBe('full');
    expect((await core.syncBsm(fetch, { statusFilter: ['new'] })).mode).toBe('delta');
  });

  it('keeps the last run time when a delta fails', async () => {
    let now = new Date('2026-11-18T10:00:00Z');
    const core = createCore({ databaseFile: ':memory:', clock: { now: () => now } });
    await core.syncBsm(fakeBsm([ticket('A1')]).fetch, {});
    now = new Date('2026-11-18T11:00:00Z');
    await expect(
      core.syncBsm(async () => {
        throw new Error('offline');
      }, {}),
    ).rejects.toThrow('offline');
    now = new Date('2026-11-18T12:00:00Z');
    const filters: unknown[] = [];
    await core.syncBsm(async (path, body) => {
      if (path === '/personal/api/application') return { Applications: [] };
      filters.push((body as { filter: unknown }).filter);
      return { Indications: [] };
    }, {});
    // Still from the last successful run at 10:00, not from the failed one.
    expect(filters).toEqual([{ minChangeDateFilter: '2026-11-18T09:55:00.000Z' }]);
  });

  it('changes nothing when BSM fails', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    await core.syncBsm(fakeBsm([ticket('A1')]).fetch, {});
    await expect(
      core.syncBsm(async () => {
        throw new Error('offline');
      }, {}),
    ).rejects.toThrow('offline');
    expect(core.tickets.list()).toHaveLength(1);
  });

  it('lists blockers first, then the most recently changed', async () => {
    const core = createCore({ databaseFile: ':memory:', clock });
    core.tickets.applySnapshot(
      [
        ticket('A1', '2026-11-03T00:00:00Z'),
        { ...ticket('B2', '2026-11-01T00:00:00Z'), categoryName: 'Blocker' },
        ticket('C3', '2026-11-02T00:00:00Z'),
        { ...ticket('D4', '2026-11-02T00:00:00Z'), categoryName: 'Blocker' },
      ],
      [],
    );
    expect(core.tickets.list().map((t) => t.number)).toEqual(['D4', 'B2', 'A1', 'C3']);
  });
});
