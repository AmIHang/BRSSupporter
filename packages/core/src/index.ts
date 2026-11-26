import { fetchApplications, queryAllIndications, type BsmFetch, type BsmFilter } from './bsm.js';
import { systemClock, type Clock } from './clock.js';
import { MemorySecretStore, type SecretStore } from './secrets.js';
import { eq } from 'drizzle-orm';
import { openDatabase } from './db/open.js';
import { meta } from './db/schema.js';
import { lookupOtmaNumber, lookupOtmaTicket } from './otma.js';
import { ProjectService, TicketService, type SyncResult } from './tickets.js';

export * from './bsm.js';
export * from './clock.js';
export * from './settings.js';
export * from './secrets.js';
export { NO_PROJECT } from './tickets.js';
export type {
  Contributor,
  Project,
  Release,
  RepoInfo,
  RepoLink,
  Ticket,
  SyncResult,
} from './tickets.js';

export interface CoreOptions {
  /** SQLite file, `:memory:` for tests. */
  databaseFile: string;
  clock?: Clock;
  /** Credential Manager in production; in memory when left out (tests). */
  secrets?: SecretStore;
}

/** A delta asks for changes since the last run minus this, against clock skew and slow saves. */
export const DELTA_BUFFER_MS = 5 * 60_000;
/** A full sync brings closed tickets (past "in process") changed within these days only. */
export const CLOSED_HISTORY_DAYS = 30;
const ALL_STATUSES = ['new', 'inprocess', 'delivered', 'completed', 'archived'] as const;

export function createCore(options: CoreOptions) {
  const { db, close } = openDatabase(options.databaseFile);
  const clock = options.clock ?? systemClock;
  const tickets = new TicketService(db, clock);
  const getMeta = (key: string) =>
    db.select().from(meta).where(eq(meta.key, key)).get()?.value ?? null;
  const setMeta = (key: string, value: string) =>
    db
      .insert(meta)
      .values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value } })
      .run();

  return {
    tickets,
    secrets: options.secrets ?? new MemorySecretStore(),
    projects: new ProjectService(db),
    /**
     * Syncs with BSM; on any error nothing is changed. Normally a delta (tickets changed since the
     * last successful run, minus DELTA_BUFFER_MS); a full snapshot when `full` is set, on the
     * first run and after the filter changed.
     */
    async syncBsm(
      fetch: BsmFetch,
      filter: BsmFilter,
      opts: { full?: boolean } = {},
    ): Promise<SyncResult & { mode: 'full' | 'delta' }> {
      const startedAt = clock.now();
      const filterKey = JSON.stringify(filter);
      const last = getMeta('lastSyncAt');
      const full = opts.full || !last || getMeta('lastSyncFilter') !== filterKey;
      const apps = await fetchApplications(fetch);
      let result: SyncResult;
      if (full) {
        // Open tickets all; closed ones only of the last CLOSED_HISTORY_DAYS, not all of BSM's
        // history. Older closed tickets count as gone.
        const statuses = filter.statusFilter ?? [...ALL_STATUSES];
        const isOpen = (s: string) => s === 'new' || s === 'inprocess';
        const open = statuses.filter(isOpen);
        const closed = statuses.filter((s) => !isOpen(s));
        const closedSince = new Date(startedAt.getTime() - CLOSED_HISTORY_DAYS * 86_400_000);
        const parts = [
          open.length ? await queryAllIndications(fetch, { ...filter, statusFilter: open }) : null,
          closed.length
            ? await queryAllIndications(fetch, {
                ...filter,
                statusFilter: closed,
                minChangeDateFilter: closedSince.toISOString(),
              })
            : null,
        ].filter((p) => p !== null);
        // One snapshot; a ticket that changed status between the two queries counts once.
        const indications = [
          ...new Map(parts.flatMap((p) => p.indications).map((i) => [i.number, i])).values(),
        ];
        result = tickets.applySnapshot(
          indications,
          parts.flatMap((p) => p.users),
          apps,
        );
      } else {
        // Without status filter: tickets that left it (e.g. delivered) must show up to be removed.
        const { statusFilter, ...rest } = filter;
        const since = new Date(new Date(last).getTime() - DELTA_BUFFER_MS).toISOString();
        const { indications, users } = await queryAllIndications(fetch, {
          ...rest,
          minChangeDateFilter: since,
        });
        const matching = (i: { status: string }) =>
          !statusFilter || (statusFilter as string[]).includes(i.status);
        result = tickets.applyDelta(indications, users, apps, matching);
      }
      setMeta('lastSyncAt', startedAt.toISOString());
      setMeta('lastSyncFilter', filterKey);
      return { ...result, mode: full ? 'full' : 'delta' };
    },
    /**
     * Looks up the OTMA number of open tickets (see TicketService.otmaPending) via BSM, one
     * by one; each result is saved at once, so an error (e.g. login) only stops the rest.
     */
    async lookupOtmaNumbers(
      fetch: BsmFetch,
      numbers: string[] = tickets.otmaPending(),
    ): Promise<{ checked: number; found: number }> {
      let checked = 0;
      let found = 0;
      for (const number of numbers) {
        const otma = await lookupOtmaNumber(fetch, number);
        tickets.setOtmaNumber(number, otma);
        checked++;
        if (otma) found++;
      }
      return { checked, found };
    },
    /**
     * Refreshes OTMA responsible person and status of all listed tickets in process plus the given
     * ones (e.g. whose BSM status just changed), each with an OTMA number. `otmaFetch` must go to
     * OTMA. Each result is saved at once; an error stops the rest.
     */
    async refreshOtmaInfo(
      otmaFetch: BsmFetch,
      also: string[] = [],
    ): Promise<{ checked: number; changed: number }> {
      const extra = new Set(also);
      const due = tickets
        .list()
        .filter((t) => t.status === 'inprocess' || extra.has(t.number))
        .flatMap((t) => (t.otmaNumber ? [{ ...t, otmaNumber: t.otmaNumber }] : []));
      let checked = 0;
      let changed = 0;
      for (const t of due) {
        const info = await lookupOtmaTicket(otmaFetch, t.otmaNumber);
        tickets.setOtmaInfo(t.number, info);
        checked++;
        if (info.responsible !== t.otmaResponsible || info.status !== t.otmaStatus) changed++;
      }
      return { checked, changed };
    },
    close,
  };
}
export type Core = ReturnType<typeof createCore>;
