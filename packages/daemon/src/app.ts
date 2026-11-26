import {
  ACCOUNT_SYSTEMS,
  type AccountSystem,
  type Core,
  type RepoLink,
  type Settings,
  type SyncResult,
} from '@brssupporter/core';
import express from 'express';
import { z } from 'zod';
import { errorText } from './bsm-edge.js';
import { DEFAULT_ALLOWED_ORIGINS, hostCheck, originCheck } from './http/security.js';
import type { UpdateInfo } from './update.js';

export interface SyncState {
  lastRunAt: string | null;
  lastResult: (SyncResult & { mode: 'full' | 'delta' }) | null;
  lastError: string | null;
  /** Error of the OTMA part of the last sync (the BSM part may still have worked). */
  otmaError: string | null;
  running: boolean;
}

export interface AppDeps {
  core: Core;
  getPort: () => number;
  /** full: fetch everything instead of the delta. */
  sync: (full?: boolean) => Promise<void>;
  /** Takes the ticket over in BSM (assigns it to the stored BSM account); user-facing errors. */
  takeOver: (number: string) => Promise<void>;
  syncState: () => SyncState;
  /** Installed version ("dev" when started by hand). */
  version: string;
  /** Newer release on GitHub? */
  checkUpdate: () => Promise<UpdateInfo>;
  /** A stored account was saved or removed: its old session must not be used any more. */
  accountChanged: (system: AccountSystem) => void;
  /** Checks a TFS Git link and completes it (project, wiki); rejects with a user-facing reason. */
  resolveRepo: (url: string) => Promise<RepoLink>;
  getSettings: () => Settings;
  /** Validates and saves; throws a ZodError for invalid input. */
  updateSettings: (patch: unknown) => Settings;
  allowedOrigins?: readonly string[];
}

/** Link to a TFS repository (Git or TFVC browse URL), opened in the browser: http(s) only. */
const repoUrlSchema = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\/\S+$/i)
  .nullable();

const projectPatchSchema = z
  .object({
    applicationName: z.string(),
    /** '' = the application's tickets without project. */
    name: z.string(),
    hidden: z.boolean().optional(),
    /** null = none of its own, the customer's applies. */
    repoUrl: repoUrlSchema.optional(),
  })
  .refine((b) => b.hidden !== undefined || b.repoUrl !== undefined);

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
    repoUrl: repoUrlSchema.optional(),
  })
  .refine((b) => b.hidden !== undefined || b.color !== undefined || b.repoUrl !== undefined);

const systemSchema = z.enum(ACCOUNT_SYSTEMS);

// shortcut: no bearer token yet (BRSOrganizer has one) – Host/Origin checks stop browsers and DNS
// rebinding, not other local processes. Those could take over tickets via POST .../accept or
// replace the stored accounts (never read the passwords), but could just as well use the Edge profile in the data folder directly; add the
// token with the Tauri sidecar (Rust reads it from the Credential Manager, like BRSOrganizer).
export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck(deps.getPort));
  app.use(originCheck(deps.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS));

  /** The app checks with this that the daemon on the port is ours before it starts one. */
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'BRSSupporter', version: deps.version });
  });
  app.get('/api/update', async (_req, res) => {
    res.json(await deps.checkUpdate());
  });
  app.get('/api/tickets', (_req, res) => {
    res.json({ tickets: deps.core.tickets.list() });
  });
  /** Only tickets the list shows as new; BSM is asked again before anything is clicked. */
  app.post('/api/tickets/:number/accept', async (req, res) => {
    const { number } = req.params;
    const ticket = deps.core.tickets.list().find((t) => t.number === number);
    if (!ticket) return void res.status(404).json({ error: 'ticket_not_found' });
    if (ticket.status !== 'new') return void res.status(409).json({ error: 'ticket_not_new' });
    try {
      await deps.takeOver(number);
      res.json({ number });
    } catch (err) {
      res.status(502).json({ error: errorText(err) });
    }
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
  /**
   * The checked repository for a patch: undefined = not part of it, null = remove. Answers 400
   * with the reason (e.g. TFVC, ambiguous) and returns false when the link is refused.
   */
  async function checkedRepo(
    repoUrl: string | null | undefined,
    res: express.Response,
  ): Promise<RepoLink | null | undefined | false> {
    if (repoUrl === undefined || repoUrl === null) return repoUrl;
    try {
      return await deps.resolveRepo(repoUrl);
    } catch (err) {
      res.status(400).json({ error: errorText(err) });
      return false;
    }
  }
  /** Answers with the saved repository (completed link, wiki), so the UI shows what applies. */
  app.patch('/api/projects', express.json(), async (req, res) => {
    const body = projectPatchSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    const { applicationName, name, hidden, repoUrl } = body.data;
    const repo = await checkedRepo(repoUrl, res);
    if (repo === false) return;
    const found =
      (hidden === undefined || deps.core.projects.setHidden(applicationName, name, hidden)) &&
      (repo === undefined || deps.core.projects.setRepo(applicationName, name, repo));
    if (!found) return void res.status(404).json({ error: 'project_not_found' });
    res.json({ ...body.data, repo });
  });
  app.patch('/api/customers', express.json(), async (req, res) => {
    const body = customerPatchSchema.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: 'invalid_body' });
    const { customer, hidden, color, repoUrl } = body.data;
    const repo = await checkedRepo(repoUrl, res);
    if (repo === false) return;
    const found =
      (hidden === undefined || deps.core.projects.setCustomerHidden(customer, hidden)) &&
      (color === undefined || deps.core.projects.setCustomerColor(customer, color)) &&
      (repo === undefined || deps.core.projects.setCustomerRepo(customer, repo));
    if (!found) return void res.status(404).json({ error: 'customer_not_found' });
    res.json({ ...body.data, repo });
  });
  return app;
}
