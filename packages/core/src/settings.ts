import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { bsmFilterSchema } from './bsm.js';

export const APP_NAME = 'BRSSupporter';

export function dataDir(): string {
  return (
    process.env.BRSSUPPORTER_DATA_DIR ??
    join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), APP_NAME)
  );
}

export const settingsSchema = z.object({
  /** Which BSM tickets are monitored (queryIndications filter); default all, any status. */
  bsmFilter: bsmFilterSchema.default({}),
  /** How often the delta is fetched from BSM (the list refreshes with it). */
  syncIntervalMinutes: z.number().int().min(1).max(1440).default(5),
});
export type Settings = z.infer<typeof settingsSchema>;

/** What the UI may change. */
export const settingsPatchSchema = settingsSchema.pick({ syncIntervalMinutes: true }).partial();

/** Validates `patch`, writes the merged settings (atomically) and returns them. */
export function saveSettings(dir: string, patch: unknown): Settings {
  // zod fills in defaults for missing optional fields too: only apply the fields that were sent.
  const parsed = settingsPatchSchema.parse(patch);
  const sent = Object.fromEntries(Object.entries(parsed).filter(([k]) => k in (patch as object)));
  const next = settingsSchema.parse({ ...loadSettings(dir), ...sent });
  const file = join(dir, 'settings.json');
  writeFileSync(`${file}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${file}.tmp`, file);
  return next;
}

/** `settings.json` in the data folder; defaults when missing. */
export function loadSettings(dir: string): Settings {
  const file = join(dir, 'settings.json');
  return settingsSchema.parse(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
}
