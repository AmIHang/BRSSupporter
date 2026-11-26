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
import { BsmLoginRequiredError, edgeSessions, errorText } from './bsm-edge.js';
import { DEFAULT_ALLOWED_ORIGINS } from './http/security.js';
import { takeOverTicket } from './takeover.js';
import { isWorkingHours, ticketPause } from './working-hours.js';

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
const { bsm, otma, reset } = edgeSessions({
  dataDir: dir,
  log,
  account: (system) => storedAccount(core.secrets, system),
});

/**
 * OTMA responsible persons of `which` (a batch size or ticket numbers), with the OTMA account.
 * Errors (e.g. no OTMA account) only delay it to the next run.
 */
let batchRunning = false;
async function refreshResponsibles(which: number | string[]): Promise<void> {
  const batch = typeof which === 'number';
  // A batch can take minutes (pauses); the next one waits. Given tickets always go in the queue.
  if (batch && batchRunning) return;
  if (batch) batchRunning = true;
  try {
    const r = await otma((fetch) =>
      core.refreshOtmaResponsibles(fetch, which, () => ticketPause()),
    );
    if (r.checked) log(`otma responsible: ${r.checked} checked, ${r.changed} changed`);
  } catch (err) {
    log(`otma responsible failed: ${errorText(err)}`);
  } finally {
    if (batch) batchRunning = false;
  }
}

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
    const result = await bsm(async (fetch) => {
      const synced = await core.syncBsm(fetch, settings.bsmFilter, { full });
      log(
        `sync (${synced.mode}): +${synced.added.length} ~${synced.changed.length} -${synced.gone.length}`,
      );
      // Same BSM session. Login errors go up (the session signs in and runs this again); others
      // only cost the OTMA numbers until the next run, the ticket sync itself succeeded.
      try {
        const numbers = await core.lookupOtmaNumbers(fetch);
        if (numbers.checked) log(`otma: ${numbers.checked} checked, ${numbers.found} found`);
      } catch (err) {
        if (err instanceof BsmLoginRequiredError) throw err;
        log(`otma lookup failed: ${errorText(err)}`);
      }
      return synced;
    });
    Object.assign(state, { lastResult: result, lastError: null });
    // A status change usually comes with a new OTMA responsible (e.g. handed back on delivery).
    if (result.statusChanged.length) void refreshResponsibles(result.statusChanged);
  } catch (err) {
    state.lastError = errorText(err);
    log(`sync failed: ${state.lastError}`);
  } finally {
    Object.assign(state, { running: false, lastRunAt: new Date().toISOString() });
  }
}

/** Takes the ticket over in BSM (same Edge session queue as the sync), then syncs the change. */
async function takeOver(number: string): Promise<void> {
  log(`taking over ${number}`);
  try {
    await bsm((fetch, ctx) => takeOverTicket(fetch, ctx, number));
  } catch (err) {
    log(`take over ${number} failed: ${errorText(err)}`);
    throw err;
  }
  log(`took over ${number}`);
  void sync();
}

const port = Number(args.port);
const app = createApp({
  core,
  getPort: () => port,
  sync,
  takeOver,
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
    if (
      settings.syncIntervalMinutes !== before.syncIntervalMinutes ||
      settings.otmaResponsibleIntervalMinutes !== before.otmaResponsibleIntervalMinutes
    ) {
      schedule();
    }
    return settings;
  },
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...args['allow-origin']],
});
app.listen(port, '127.0.0.1', () => log(`listening on http://127.0.0.1:${port}, data ${dir}`));

let timer: NodeJS.Timeout | undefined;
let responsibleTimer: NodeJS.Timeout | undefined;
function schedule(): void {
  if (args['no-sync']) return;
  clearInterval(timer);
  timer = setInterval(() => void sync(), settings.syncIntervalMinutes * 60_000);
  clearInterval(responsibleTimer);
  // Like a person at work: OTMA batches only Mon–Fri 7–19.
  responsibleTimer = setInterval(() => {
    if (isWorkingHours(new Date())) void refreshResponsibles(settings.otmaResponsibleBatchSize);
  }, settings.otmaResponsibleIntervalMinutes * 60_000);
  log(
    `sync every ${settings.syncIntervalMinutes} min, otma responsible every ` +
      `${settings.otmaResponsibleIntervalMinutes} min (${settings.otmaResponsibleBatchSize} per batch)`,
  );
}

if (!args['no-sync']) void sync();
schedule();
