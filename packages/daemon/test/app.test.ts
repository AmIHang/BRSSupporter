import { createCore, loadSettings, saveSettings } from '@brssupporter/core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

function setup(takeOver: (number: string) => Promise<void> = async () => undefined) {
  const core = createCore({ databaseFile: ':memory:' });
  core.tickets.applySnapshot(
    [
      {
        number: 'ELLBg0169',
        status: 'new',
        applicationName: 'ELL BRS',
        projectName: 'ELL',
        createDate: '2026-11-01T00:00:00Z',
        changeDate: '2026-11-01T00:00:00Z',
      },
    ],
    [],
  );
  const syncs: boolean[] = [];
  const changed: string[] = [];
  const app = createApp({
    core,
    getPort: () => 47910,
    sync: async (full?: boolean) => void syncs.push(full ?? false),
    takeOver,
    syncState: () => ({
      lastRunAt: null,
      lastResult: null,
      lastError: null,
      running: false,
    }),
    accountChanged: (system) => void changed.push(system),
    getSettings: () => loadSettings(dir),
    updateSettings: (patch) => saveSettings(dir, patch),
  });
  return { app, core, syncs: () => syncs, changed };
}

const dir = mkdtempSync(join(tmpdir(), 'brssupporter-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('REST', () => {
  it('lists tickets', async () => {
    const res = await request(setup().app).get('/api/tickets').set('Host', '127.0.0.1:47910');
    expect(res.status).toBe(200);
    expect(res.body.tickets.map((t: { number: string }) => t.number)).toEqual(['ELLBg0169']);
  });

  it('rejects foreign hosts and origins', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/tickets').set('Host', 'evil.example:47910')).status).toBe(
      403,
    );
    const res = await request(app)
      .get('/api/tickets')
      .set('Host', '127.0.0.1:47910')
      .set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
  });

  it('hides a project', async () => {
    const { app } = setup();
    const patch = (body: object) =>
      request(app).patch('/api/projects').set('Host', '127.0.0.1:47910').send(body);
    expect((await patch({ applicationName: 'ELL BRS', name: 'ELL', hidden: true })).status).toBe(
      200,
    );
    expect((await patch({ applicationName: 'ELL BRS', name: 'X', hidden: true })).status).toBe(404);
    expect((await patch({ name: 'ELL' })).status).toBe(400);
    const res = await request(app).get('/api/tickets').set('Host', '127.0.0.1:47910');
    expect(res.body.tickets).toEqual([]);
  });

  it('hides a whole customer', async () => {
    const { app, core } = setup();
    const patch = (body: object) =>
      request(app).patch('/api/customers').set('Host', '127.0.0.1:47910').send(body);
    expect((await patch({ customer: 'Unbekannt', hidden: true })).status).toBe(404);
    expect((await patch({ customer: 'ELL' })).status).toBe(400);
    core.tickets.applySnapshot([], [], [{ name: 'ELL BRS', customer: 'ELL' }]);
    expect((await patch({ customer: 'ELL', hidden: true })).status).toBe(200);
    expect(core.projects.list()).toMatchObject([{ customer: 'ELL', hidden: true }]);

    expect((await patch({ customer: 'ELL', color: 'red' })).status).toBe(400);
    expect((await patch({ customer: 'ELL', color: '#AA0011' })).status).toBe(200);
    expect(core.projects.list()).toMatchObject([{ customerColor: '#AA0011', hidden: true }]);
    expect((await patch({ customer: 'ELL', color: null })).status).toBe(200);
    expect(core.projects.list()[0]!.customerColor).toBeNull();
  });

  it('saves the sync interval and rejects invalid values', async () => {
    const { app } = setup();
    const patch = (body: object) =>
      request(app).patch('/api/settings').set('Host', '127.0.0.1:47910').send(body);
    expect((await patch({ syncIntervalMinutes: 0 })).status).toBe(400);
    expect((await patch({ bsmFilter: {} })).body).toMatchObject({ syncIntervalMinutes: 5 });
    expect((await patch({ syncIntervalMinutes: 15 })).body).toEqual({
      syncIntervalMinutes: 15,
      bsmFilter: {},
      otmaResponsibleIntervalMinutes: 5,
      otmaResponsibleBatchSize: 5,
    });
    expect((await patch({ otmaResponsibleBatchSize: 0 })).status).toBe(400);
    expect((await patch({ otmaResponsibleBatchSize: 101 })).status).toBe(400);
    expect(
      (await patch({ otmaResponsibleIntervalMinutes: 10, otmaResponsibleBatchSize: 8 })).body,
    ).toMatchObject({
      syncIntervalMinutes: 15,
      otmaResponsibleIntervalMinutes: 10,
      otmaResponsibleBatchSize: 8,
    });
    const res = await request(app).get('/api/settings').set('Host', '127.0.0.1:47910');
    expect(res.body.syncIntervalMinutes).toBe(15);
  });

  it('stores BSM and OTMA account apart, never hands out a password', async () => {
    const { app, core, changed } = setup();
    const call = (method: 'get' | 'put' | 'delete', system: string, body?: object) =>
      request(app)[method](`/api/account/${system}`).set('Host', '127.0.0.1:47910').send(body);
    expect((await call('get', 'bsm')).body).toEqual({ user: null, passwordSet: false });
    expect((await call('get', 'jira')).status).toBe(404);
    expect((await call('put', 'bsm', { user: 'max.muster', password: '' })).status).toBe(400);
    expect((await call('put', 'bsm', { user: ' max.muster ', password: 's3cret' })).status).toBe(
      204,
    );
    expect((await call('put', 'otma', { user: 'max.otma', password: 'otma!' })).status).toBe(204);
    const stored = await call('get', 'bsm');
    expect(stored.body).toEqual({ user: 'max.muster', passwordSet: true });
    expect(JSON.stringify(stored.body)).not.toContain('s3cret');
    expect(core.secrets.get('bsm-password')).toBe('s3cret');
    expect(core.secrets.get('otma-password')).toBe('otma!');
    expect((await call('delete', 'bsm')).status).toBe(204);
    expect((await call('get', 'bsm')).body).toEqual({ user: null, passwordSet: false });
    expect((await call('get', 'otma')).body).toEqual({ user: 'max.otma', passwordSet: true });
    expect(changed).toEqual(['bsm', 'otma', 'bsm']);
  });

  it('refuses the same e-mail address for BSM and OTMA', async () => {
    const { app, core, changed } = setup();
    const put = (system: string, user: string) =>
      request(app)
        .put('/api/account/' + system)
        .set('Host', '127.0.0.1:47910')
        .send({ user, password: 'pw' });
    expect((await put('bsm', 'max@boom.at')).status).toBe(204);
    const res = await put('otma', ' MAX@boom.at ');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('verschiedene Konten');
    expect(core.secrets.get('otma-user')).toBeNull();
    expect((await put('otma', 'max.otma@boom.at')).status).toBe(204);
    expect((await put('bsm', 'max.otma@boom.at')).status).toBe(409);
    expect(changed).toEqual(['bsm', 'otma']);
  });
  it('starts a sync', async () => {
    const s = setup();
    const res = await request(s.app).post('/api/sync').set('Host', '127.0.0.1:47910');
    expect(res.status).toBe(202);
    const full = await request(s.app)
      .post('/api/sync')
      .set('Host', '127.0.0.1:47910')
      .send({ full: true });
    expect(full.status).toBe(202);
    const bad = await request(s.app)
      .post('/api/sync')
      .set('Host', '127.0.0.1:47910')
      .send({ full: 'yes' });
    expect(bad.status).toBe(400);
    expect(s.syncs()).toEqual([false, true]);
  });
  it("takes over only new tickets and reports BSM's error", async () => {
    const taken: string[] = [];
    const { app, core } = setup(async (n) => void taken.push(n));
    const accept = (a: typeof app, n: string) =>
      request(a)
        .post('/api/tickets/' + n + '/accept')
        .set('Host', '127.0.0.1:47910');
    expect((await accept(app, 'NOPEg0001')).status).toBe(404);
    expect((await accept(app, 'ELLBg0169')).status).toBe(200);
    expect(taken).toEqual(['ELLBg0169']);

    core.tickets.applySnapshot(
      [
        {
          number: 'ELLBg0169',
          status: 'inprocess',
          applicationName: 'ELL BRS',
          projectName: 'ELL',
          createDate: '2026-11-01T00:00:00Z',
          changeDate: '2026-11-02T00:00:00Z',
        },
      ],
      [],
    );
    expect((await accept(app, 'ELLBg0169')).status).toBe(409);
    expect(taken).toEqual(['ELLBg0169']);

    const failing = setup(async () => {
      throw new Error('ELLBg0169 ist nicht mehr neu');
    });
    const res = await accept(failing.app, 'ELLBg0169');
    expect(res.status).toBe(502);
    expect(res.body.error).toBe('ELLBg0169 ist nicht mehr neu');
  });
});
