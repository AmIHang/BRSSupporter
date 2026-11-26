import { describe, expect, it } from 'vitest';
import { createCore, type BsmFetch } from '../src/index.js';
import { lookupOtmaTicket } from '../src/otma.js';

const ticket = (number: string, status: string) => ({
  number,
  status,
  createDate: '2026-11-01T00:00:00Z',
  changeDate: '2026-11-01T00:00:00Z',
});

/** Fake OTMA: jump answer → view with the responsible person of `people[otmaNumber]`. */
function fakeOtma(people: Record<string, string>) {
  const viewed: string[] = [];
  const fetch: BsmFetch = async (_path, body) => {
    const b = body as { WorkflowName?: string; ContextOPath: string };
    if (b.WorkflowName === 'JumpToOrderProcess') {
      const key = /^\|(\d+)\|/.exec(b.ContextOPath)![1]!;
      if (!(key in people)) {
        // As OTMA answers for a deleted ticket.
        const message = `Die Meldung mit der Nummer ${key} konnte nicht gefunden werden.`;
        return { error: { message, referenceId: 'x' } };
      }
      return {
        link: {
          wf: {
            contextopath: `${key}@1A`,
            entity: 'dotNetBF.Modules.Resources.OrderProcess',
            type: 'View',
            args: { formname: 'orderprocess-web' },
          },
        },
      };
    }
    const key = b.ContextOPath.split('@')[0]!;
    viewed.push(key);
    return {
      ui: {
        form: [
          {
            items: [
              { feat: 'cfResponsiblePersonDisplayText', value: people[key] },
              { feat: 'Status', value: 'In Arbeit' },
            ],
          },
        ],
      },
    };
  };
  return { fetch, viewed };
}

describe('refreshOtmaInfo', () => {
  it('refreshes all tickets in process plus the given ones, each with an OTMA ticket', async () => {
    const core = createCore({ databaseFile: ':memory:' });
    core.tickets.applySnapshot(
      [
        ticket('A1', 'inprocess'),
        ticket('B2', 'inprocess'),
        ticket('C3', 'new'), // only when given (status changed)
        ticket('D4', 'delivered'), // only when given
        ticket('E5', 'inprocess'), // no OTMA ticket
        { ...ticket('F6', 'inprocess'), applicationName: 'X', projectName: 'Hidden' },
        ticket('G7', 'completed'), // neither in process nor given
      ],
      [],
    );
    core.tickets.setOtmaNumber('A1', '101');
    core.tickets.setOtmaNumber('B2', '102');
    core.tickets.setOtmaNumber('C3', '103');
    core.tickets.setOtmaNumber('D4', '104');
    core.tickets.setOtmaNumber('E5', null);
    core.tickets.setOtmaNumber('F6', '106');
    core.tickets.setOtmaNumber('G7', '107');
    core.projects.setHidden('X', 'Hidden', true);
    const otma = fakeOtma({
      '101': 'Max Muster',
      '102': 'Kein Verantwortlicher zugewiesen',
      '104': 'Erika Beispiel',
    });

    // A1 got a responsible, B2 none but a status, D4 both: all changed.
    expect(await core.refreshOtmaInfo(otma.fetch, ['D4'])).toEqual({ checked: 3, changed: 3 });
    expect(otma.viewed.sort()).toEqual(['101', '102', '104']);
    // Same again: checked, nothing changed.
    expect(await core.refreshOtmaInfo(otma.fetch)).toEqual({ checked: 2, changed: 0 });
    const info = Object.fromEntries(
      core.tickets.list().map((t) => [t.number, [t.otmaResponsible, t.otmaStatus]]),
    );
    expect(info).toEqual({
      A1: ['Max Muster', 'In Arbeit'],
      B2: [null, 'In Arbeit'],
      C3: [null, null],
      D4: ['Erika Beispiel', 'In Arbeit'],
      E5: [null, null],
      G7: [null, null],
    });
    expect(otma.viewed).not.toContain('106');
    expect(otma.viewed).not.toContain('107');
  });

  it('remembers where a view is: one request per later check, the jump again when stale', async () => {
    const calls: string[] = [];
    let stale = false;
    const fetch: BsmFetch = async (_path, body) => {
      const b = body as { WorkflowName?: string; ContextOPath: string };
      calls.push(b.WorkflowName ?? 'view');
      if (b.WorkflowName === 'JumpToOrderProcess') {
        return {
          link: {
            wf: {
              contextopath: '5A@1A',
              entity: 'dotNetBF.Modules.Resources.OrderProcess',
              type: 'View',
              args: { formname: 'orderprocess-web' },
            },
          },
        };
      }
      if (stale) {
        stale = false;
        return { error: { message: 'Objekt nicht vorhanden' } };
      }
      return { ui: { form: [{ feat: 'cfResponsiblePersonDisplayText', value: 'GRA' }] } };
    };
    const responsible = async () => (await lookupOtmaTicket(fetch, '777')).responsible;
    expect(await responsible()).toBe('GRA');
    expect(await responsible()).toBe('GRA');
    expect(calls).toEqual(['JumpToOrderProcess', 'view', 'view']);
    calls.length = 0;
    stale = true;
    expect(await responsible()).toBe('GRA');
    expect(calls).toEqual(['view', 'JumpToOrderProcess', 'view']);
  });

  it('takes a deleted OTMA ticket as without responsible and goes on', async () => {
    const core = createCore({ databaseFile: ':memory:' });
    core.tickets.applySnapshot([ticket('A1', 'inprocess'), ticket('B2', 'inprocess')], []);
    core.tickets.setOtmaNumber('A1', '999'); // deleted in OTMA
    core.tickets.setOtmaNumber('B2', '102');
    const otma = fakeOtma({ '102': 'Erika Beispiel' });
    expect(await core.refreshOtmaInfo(otma.fetch)).toEqual({ checked: 2, changed: 1 });
    expect(core.tickets.list().map((t) => t.otmaResponsible)).toEqual([null, 'Erika Beispiel']);
  });

  it('stops the batch on an error and keeps what was saved', async () => {
    const core = createCore({ databaseFile: ':memory:' });
    core.tickets.applySnapshot([ticket('A1', 'inprocess'), ticket('B2', 'inprocess')], []);
    // Numbers of their own: no view address remembered from other tests, two requests each.
    core.tickets.setOtmaNumber('A1', '301');
    core.tickets.setOtmaNumber('B2', '302');
    let calls = 0;
    const ok = fakeOtma({ '301': 'Max Muster', '302': 'Erika Beispiel' }).fetch;
    const failing: BsmFetch = async (path, body) => {
      if (++calls > 2) throw new Error('OTMA: nicht angemeldet');
      return ok(path, body);
    };
    await expect(core.refreshOtmaInfo(failing)).rejects.toThrow('nicht angemeldet');
    expect(core.tickets.list().filter((t) => t.otmaResponsible)).toHaveLength(1);
  });
});
