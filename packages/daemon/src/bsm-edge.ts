import { BSM_ORIGIN, OTMA_ORIGIN, type AccountSystem, type BsmFetch } from '@brssupporter/core';
import { join } from 'node:path';
import type { BrowserContext, Cookie } from 'playwright-core';

/** BSM and OTMA run on the same web framework (same API, same Keycloak). */
interface System {
  origin: string;
  label: 'BSM' | 'OTMA';
  account: AccountSystem;
}

/** The system has no (valid) session: it redirected to its Keycloak login or answered 401. */
export class BsmLoginRequiredError extends Error {
  constructor(label: System['label'] = 'BSM') {
    super(`${label}: nicht angemeldet`);
    this.name = 'BsmLoginRequiredError';
  }
}

export interface Account {
  user: string;
  password: string;
}

export interface EdgeBsmOptions {
  /** Data folder; each system gets its own Edge profile in it (`edge-bsm`, `edge-otma`). */
  dataDir: string;
  log?: (msg: string) => void;
  /** The account stored for the system – the only one ever used to sign in. */
  account: (system: AccountSystem) => Account | null;
}

/** A job with a logged-in connection to one system (and its Edge context for UI steps). */
export type BsmJob<T> = (fetch: BsmFetch, ctx: BrowserContext) => Promise<T>;
/** Runs a job, one after the other per system; Edge stays open until it is idle. */
export type BsmSession = <T>(fn: BsmJob<T>) => Promise<T>;

/** Keycloak of BSM and OTMA: the only page a stored password is ever typed into. */
const KEYCLOAK_ORIGIN = 'https://auth.boomsoftware.com';
/** How long a sign-in with the stored account may take. */
const LOGIN_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The headless Edge closes after this long without a job (e.g. at night). */
const IDLE_MS = 10 * 60_000;

/**
 * Playwright's request errors append a "Call log" with all request headers – the session
 * cookies included. Only the first line goes on (into logs and the REST sync state).
 */
export function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300);
}

function fetchVia(ctx: BrowserContext, { origin, label }: System): BsmFetch {
  return async (path, body) => {
    const url = `${origin}${path}`;
    const opts = { headers: { Accept: 'application/json' }, maxRedirects: 0, timeout: 60_000 };
    const res = await (
      body === undefined
        ? ctx.request.get(url, opts)
        : ctx.request.post(url, { ...opts, data: body })
    ).catch((err: unknown) => {
      throw new Error(`${label}: ${errorText(err)}`);
    });
    // Without a session BSM answers 302 to /loginoa (or the login page itself), OTMA 401.
    const type = res.headers()['content-type'] ?? '';
    if (res.status() === 302 || res.status() === 401 || type.includes('html')) {
      throw new BsmLoginRequiredError(label);
    }
    if (!res.ok()) throw new Error(`${label}: HTTP ${res.status()} for ${path}`);
    return res.json() as Promise<unknown>;
  };
}

const accountKey = (a: Account) => `${a.user}\n${a.password}`;

/**
 * One system through a headless Microsoft Edge (playwright-core, installed Edge) with its own
 * profile, so BSM and OTMA keep separate Keycloak sessions. Signs in with the stored account
 * only – never a window for the user. `reset` drops the session (after the account changed).
 */
function edgeSession(system: System, options: EdgeBsmOptions) {
  const log = options.log ?? (() => undefined);
  const profileDir = join(options.dataDir, `edge-${system.account}`);
  // Session cookies do not survive closing Edge; carried in memory to the next run, never on disk.
  let sessionCookies: Cookie[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  /** Cookies of an old account are dropped on the next launch. */
  let clearCookies = false;
  /** An account Keycloak refused: not tried again (lockout) until the account changes. */
  let refused: string | null = null;

  let shared: BrowserContext | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const closeShared = async () => {
    clearTimeout(idleTimer);
    const ctx = shared;
    shared = null;
    if (!ctx) return;
    sessionCookies = await ctx.cookies().then(
      (all) => all.filter((c) => c.expires === -1),
      () => sessionCookies,
    );
    // shortcut: a hung Edge is abandoned after 10 s, not killed (BRSOrganizer kills it via
    // PowerShell); add that if hangs show up in practice.
    await Promise.race([ctx.close().catch(() => undefined), sleep(10_000)]);
  };
  const context = async () => {
    clearTimeout(idleTimer);
    if (shared) return shared;
    const { chromium } = await import('playwright-core');
    const ctx = await chromium.launchPersistentContext(profileDir, {
      channel: 'msedge',
      headless: true,
    });
    if (clearCookies) {
      await ctx.clearCookies();
      clearCookies = false;
    } else if (sessionCookies.length) await ctx.addCookies(sessionCookies);
    ctx.on('close', () => {
      if (shared === ctx) shared = null;
    });
    shared = ctx;
    return ctx;
  };

  /** Opens the system (starting the OAuth login), signs in with `account`, then runs `fn`. */
  async function signIn<T>(ctx: BrowserContext, account: Account, fn: BsmJob<T>): Promise<T> {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${system.origin}/`).catch(() => undefined);
    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    // Once per attempt: a wrong password must not run into Keycloak's lockout.
    let filled = false;
    for (;;) {
      const url = page.url();
      if (url.startsWith(`${system.origin}/`) && !/loginoa|LoginOAuth/i.test(url)) {
        try {
          return await fn(fetchVia(ctx, system), ctx);
        } catch (err) {
          if (!(err instanceof BsmLoginRequiredError)) throw err;
        }
      }
      if (url.startsWith(`${KEYCLOAK_ORIGIN}/`)) {
        if (!filled && (await page.locator('#kc-form-login').count())) {
          filled = true;
          await page.fill('#username', account.user);
          await page.fill('#password', account.password);
          // Keeps the SSO login in the profile, so later runs need no password.
          await page.check('#rememberMe').catch(() => undefined);
          await page.click('#kc-login');
          log(`${system.label} login with the stored account`);
        } else if (filled && (await page.locator('#input-error, .alert-error').count())) {
          break;
        }
      }
      if (Date.now() > deadline) break;
      await sleep(500);
    }
    if (!filled) throw new Error(`${system.label}-Anmeldung: Keycloak-Formular nicht gefunden`);
    refused = accountKey(account);
    throw new Error(
      `${system.label}-Anmeldung mit ${account.user} fehlgeschlagen – Konto in den Einstellungen prüfen`,
    );
  }

  async function run<T>(fn: BsmJob<T>): Promise<T> {
    const ctx = await context();
    let ok = false;
    try {
      try {
        const result = await fn(fetchVia(ctx, system), ctx);
        ok = true;
        return result;
      } catch (err) {
        if (!(err instanceof BsmLoginRequiredError)) throw err;
      }
      const account = options.account(system.account);
      if (!account) {
        throw new Error(`${system.label}: keine Anmeldung in den Einstellungen hinterlegt`);
      }
      if (refused === accountKey(account)) {
        throw new Error(
          `${system.label}-Anmeldung mit ${account.user} wurde abgelehnt – Konto in den Einstellungen prüfen`,
        );
      }
      const result = await signIn(ctx, account, fn);
      log(`${system.label} session renewed`);
      ok = true;
      return result;
    } finally {
      // After an error a fresh Edge next time; otherwise kept until it is idle.
      if (ok) idleTimer = setTimeout(() => void closeShared(), IDLE_MS);
      else await closeShared();
    }
  }

  const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = queue.then(job, job);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    run: <T>(fn: BsmJob<T>) => enqueue(() => run(fn)),
    /** Forgets session and refused account; the next job signs in with the stored account. */
    reset: () =>
      enqueue(async () => {
        await closeShared();
        sessionCookies = [];
        clearCookies = true;
        refused = null;
      }),
  };
}

export function edgeSessions(options: EdgeBsmOptions) {
  const bsm = edgeSession({ origin: BSM_ORIGIN, label: 'BSM', account: 'bsm' }, options);
  const otma = edgeSession({ origin: OTMA_ORIGIN, label: 'OTMA', account: 'otma' }, options);
  return {
    bsm: bsm.run as BsmSession,
    otma: otma.run as BsmSession,
    reset: (system: AccountSystem) => (system === 'bsm' ? bsm.reset() : otma.reset()),
  };
}
