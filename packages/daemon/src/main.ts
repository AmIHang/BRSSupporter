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
import { powershellTfsGet, readRepoInfo, resolveTfsRepo } from './tfs.js';

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

const state: SyncState = {
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  otmaError: null,
  running: false,
};
/**
 * BSM delta (or full), the OTMA numbers with it (BSM account), then the OTMA part (OTMA account)
 * of all tickets in process and of those whose BSM status changed. An OTMA error goes to
 * `otmaError`: the BSM sync itself succeeded.
 */
async function sync(full = false): Promise<void> {
  if (state.running) return;
  state.running = true;
  let otmaError: string | null = null;
  try {
    const result = await bsm(async (fetch) => {
      // The job runs again after a sign-in: only its last attempt counts.
      otmaError = null;
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
        otmaError = `OTMA-Nummern: ${errorText(err)}`;
        log(`otma lookup failed: ${errorText(err)}`);
      }
      return synced;
    });
    Object.assign(state, { lastResult: result, lastError: null });
    try {
      const started = Date.now();
      const r = await otma((fetch) => core.refreshOtmaInfo(fetch, result.statusChanged));
      log(
        `otma info: ${r.checked} checked, ${r.changed} changed in ` +
          `${Math.round((Date.now() - started) / 1000)} s`,
      );
    } catch (err) {
      otmaError = errorText(err);
      log(`otma info failed: ${otmaError}`);
    }
    state.otmaError = otmaError;
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
  resolveRepo: (url) => resolveTfsRepo(url, powershellTfsGet, log),
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
  // A run still going (many OTMA tickets) makes the next one skip: sync() returns at once.
  timer = setInterval(() => void sync(), settings.syncIntervalMinutes * 60_000);
  log(`sync (BSM + OTMA) every ${settings.syncIntervalMinutes} min`);
}

/** TV, latest releases and recent contributors of every stored repository; failures skipped. */
async function refreshRepos(): Promise<void> {
  for (const { repoUrl, wikiUrl } of core.projects.repos()) {
    try {
      core.projects.setRepoInfo(repoUrl, await readRepoInfo(repoUrl, wikiUrl, powershellTfsGet));
    } catch (err) {
      log(`repo ${repoUrl} failed: ${errorText(err)}`);
    }
  }
}

if (!args['no-sync']) {
  void sync();
  void refreshRepos();
  // Releases come in during the day; a few wikis, a handful of requests each.
  setInterval(() => void refreshRepos(), 60 * 60_000);
}
schedule();
