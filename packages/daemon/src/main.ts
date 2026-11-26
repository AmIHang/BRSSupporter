#!/usr/bin/env node
import {
  createCore,
  dataDir,
  KeyringSecretStore,
  loadSettings,
  saveSettings,
  storedAccount,
} from '@brssupporter/core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createApp, type SyncState } from './app.js';
import { edgeSessions, errorText } from './bsm-edge.js';
import { DEFAULT_ALLOWED_ORIGINS } from './http/security.js';

const { values: args } = parseArgs({
  options: {
    port: { type: 'string', default: '47910' },
    'data-dir': { type: 'string' },
    'no-sync': { type: 'boolean', default: false },
    /** e.g. http://127.0.0.1:1440 for the Vite dev server. */
    'allow-origin': { type: 'string', multiple: true, default: [] },
  },
});

// Logs go to stderr, like in BRSOrganizer.
const log = (msg: string) => console.error(`[${new Date().toISOString()}] ${msg}`);

const dir = args['data-dir'] ?? dataDir();
mkdirSync(dir, { recursive: true });
let settings = loadSettings(dir);
const core = createCore({
  databaseFile: join(dir, 'brssupporter.db'),
  secrets: new KeyringSecretStore(),
});
const { bsm, reset } = edgeSessions({
  dataDir: dir,
  log,
  account: (system) => storedAccount(core.secrets, system),
});

const state: SyncState = {
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  running: false,
};
async function sync(full = false): Promise<void> {
  if (state.running) return;
  state.running = true;
  try {
    const result = await bsm((fetch) => core.syncBsm(fetch, settings.bsmFilter, { full }));
    log(
      `sync (${result.mode}): +${result.added.length} ~${result.changed.length} -${result.gone.length}`,
    );
    Object.assign(state, { lastResult: result, lastError: null });
  } catch (err) {
    state.lastError = errorText(err);
    log(`sync failed: ${state.lastError}`);
  } finally {
    Object.assign(state, { running: false, lastRunAt: new Date().toISOString() });
  }
}

const port = Number(args.port);
const app = createApp({
  core,
  getPort: () => port,
  sync,
  syncState: () => ({ ...state }),
  accountChanged: (system) => {
    log(`${system} account changed`);
    // The new BSM account is tried right away, so its result shows in the list.
    void reset(system).then(() => (system === 'bsm' ? sync() : undefined));
  },
  getSettings: () => settings,
  updateSettings: (patch) => {
    const before = settings;
    settings = saveSettings(dir, patch);
    if (settings.syncIntervalMinutes !== before.syncIntervalMinutes) schedule();
    return settings;
  },
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...args['allow-origin']],
});
app.listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port}, data ${dir}`));

let timer: NodeJS.Timeout | undefined;
function schedule(): void {
  if (args['no-sync']) return;
  clearInterval(timer);
  timer = setInterval(() => void sync(), settings.syncIntervalMinutes * 60_000);
  log(`sync every ${settings.syncIntervalMinutes} min`);
}

if (!args['no-sync']) void sync();
schedule();
