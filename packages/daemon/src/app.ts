import { ACCOUNT_SYSTEMS, type AccountSystem, type Core, type Settings, type SyncResult } from '@brssupporter/core';
import express from 'express';
import { z } from 'zod';
import { DEFAULT_ALLOWED_ORIGINS, hostCheck, originCheck } from './http/security.js';

export interface SyncState {
  lastRunAt: string | null;
  lastResult: (SyncResult & { mode: 'full' | 'delta' }) | null;
  lastError: string | null;
  running: boolean;
}

export interface AppDeps {
  core: Core;
  getPort: () => number;
  /** full: fetch everything instead of the delta. */
  sync: (full?: boolean) => Promise<void>;
  syncState: () => SyncState;
  /** A stored account was saved or removed: its old session must not be used any more. */
  accountChanged: (system: AccountSystem) => void;
  getSettings: () => Settings;
  /** Validates and saves; throws a ZodError for invalid input. */
  updateSettings: (patch: unknown) => Settings;
  allowedOrigins?: readonly string[];
}

const projectPatchSchema = z.object({
  applicationName: z.string(),
  /** '' = the application's tickets without project. */
  name: z.string(),
  hidden: z.boolean(),
});

const accountSchema = z.object({
  user: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(500),
});

const customerPatchSchema = z
  .object({
    customer: z.string().min(1),
    hidden: z.boolean().optional(),
    /** "#rrggbb", or null to go back to the computed color. */
    color: z
      .string()
      .regex(/^#[0-9a-f]{6}$/i)
      .nullable()
      .optional(),
  })
  .refine((b) => b.hidden !== undefined || b.color !== undefined);

const systemSchema = z.enum(ACCOUNT_SYSTEMS);

// shortcut: no bearer token yet (BRSOrganizer has one) – Host/Origin checks stop browsers and DNS
// rebinding, not other local processes. Those could replace the stored accounts (never read the
// passwords), but could just as well use the Edge profile in the data folder directly; add the
// token with the Tauri sidecar (Rust reads it from the Credential Manager, like BRSOrganizer).
export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck(deps.getPort));
  app.use(originCheck(deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS));

  app.get('/api/tickets', (_req, res) => {
    res.json({ tickets: deps.core.tickets.list() });
  });
  /** A stored account (bsm | otma): the user name only – the password never leaves the store. */
  app.get('/api/account/:system', (req, res) => {
    const system = systemSchema.safeParse(req.params.system);
    if (!system.success) return void res.status(404).json({ error: 'unknown_system' });
    res.json({
      user: deps.core.secrets.get(`${system.data}-user`),
      passwordSet: deps.core.secrets.get(`${system.data}-password`) !== null,
    });
  });
  app.put('/api/account/:system', express.json(), (req, res) => {
    const system = systemSchema.safeParse(req.params.system);
    if (!system.success) return void res.status(404).json({ error: 'unknown_system' });
    const body = accountSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    // Keycloak knows a person by the e-mail address: one person may not serve both systems.
    const other = ACCOUNT_SYSTEMS.find((s) => s !== system.data)!;
    const otherUser = deps.core.secrets.get(`${other}-user`);
    if (otherUser?.toLowerCase() === body.data.user.toLowerCase()) {
      return void res
        .status(409)
        .json({ error: 'BSM und OTMA brauchen verschiedene Konten (gleiche E-Mail-Adresse)' });
    }
    deps.core.secrets.set(`${system.data}-user`, body.data.user);
    deps.core.secrets.set(`${system.data}-password`, body.data.password);
    deps.accountChanged(system.data);
    res.status(204).end();
  });
  app.delete('/api/account/:system', (req, res) => {
    const system = systemSchema.safeParse(req.params.system);
    if (!system.success) return void res.status(404).json({ error: 'unknown_system' });
    deps.core.secrets.delete(`${system.data}-user`);
    deps.core.secrets.delete(`${system.data}-password`);
    deps.accountChanged(system.data);
    res.status(204).end();
  });
  app.get('/api/sync', (_req, res) => {
    res.json(deps.syncState());
  });
  app.post('/api/sync', express.json(), (req, res) => {
    const body = z.object({ full: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    void deps.sync(body.data.full);
    res.status(202).json(deps.syncState());
  });
  app.get('/api/settings', (_req, res) => {
    res.json(deps.getSettings());
  });
  app.patch('/api/settings', express.json(), (req, res) => {
    try {
      res.json(deps.updateSettings(req.body));
    } catch (err) {
      if (!(err instanceof z.ZodError)) throw err;
      res.status(400).json({ error: 'invalid_body' });
    }
  });
  app.get('/api/projects', (_req, res) => {
    res.json({ projects: deps.core.projects.list() });
  });
  app.patch('/api/projects', express.json(), (req, res) => {
    const body = projectPatchSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    const { applicationName, name, hidden } = body.data;
    if (!deps.core.projects.setHidden(applicationName, name, hidden)) {
      return void res.status(404).json({ error: 'project_not_found' });
    }
    res.json({ applicationName, name, hidden });
  });
  app.patch('/api/customers', express.json(), (req, res) => {
    const body = customerPatchSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    const { customer, hidden, color } = body.data;
    const found =
      (hidden === undefined || deps.core.projects.setCustomerHidden(customer, hidden)) &&
      (color === undefined || deps.core.projects.setCustomerColor(customer, color));
    if (!found) return void res.status(404).json({ error: 'customer_not_found' });
    res.json(body.data);
  });
  return app;
}
