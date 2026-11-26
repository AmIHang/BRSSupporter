/** Mirrors the daemon's REST responses (the app never imports core). */
export interface Ticket {
  number: string;
  summary: string | null;
  status: string;
  applicationName: string | null;
  projectName: string | null;
  categoryName: string | null;
  reporter: string | null;
  handler: string | null;
  link: string | null;
  createDate: string;
  changeDate: string;
  firstSeenAt: string;
  customer: string | null;
  /** Chosen color of the customer; null = computed (lib/colors.ts). */
  customerColor: string | null;
}

export interface SyncState {
  lastRunAt: string | null;
  lastResult: {
    mode: 'full' | 'delta';
    added: string[];
    changed: string[];
    gone: string[];
    statusChanged: string[];
  } | null;
  lastError: string | null;
  running: boolean;
}

export interface Project {
  /** '' for tickets without application. */
  applicationName: string;
  name: string;
  /** null when the application is not in BSM's application list. */
  customer: string | null;
  customerColor: string | null;
  hidden: boolean;
}

export type AccountSystem = 'bsm' | 'otma';

/** A stored account; the password itself is never returned. */
export interface Account {
  user: string | null;
  passwordSet: boolean;
}

export interface Settings {
  bsmFilter: Record<string, unknown>;
  syncIntervalMinutes: number;
}

const BASE = 'http://127.0.0.1:47910';

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
  if (!res.ok) {
    const msg = await res.json().then(
      (b: { error?: unknown }) => b.error,
      () => undefined,
    );
    throw new Error(typeof msg === 'string' ? msg : `Daemon: HTTP ${res.status}`);
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>;
}

export const api = {
  tickets: () => call<{ tickets: Ticket[] }>('/api/tickets').then((r) => r.tickets),
  syncState: () => call<SyncState>('/api/sync'),
  /** full: everything instead of the changes since the last run. */
  sync: (full = false) => call<SyncState>('/api/sync', 'POST', { full }),
  /** Takes the ticket over in BSM (assigns it to the stored BSM account); takes a few seconds. */
  acceptTicket: (number: string) =>
    call<unknown>(`/api/tickets/${encodeURIComponent(number)}/accept`, 'POST'),
  settings: () => call<Settings>('/api/settings'),
  account: (system: AccountSystem) => call<Account>(`/api/account/${system}`),
  saveAccount: (system: AccountSystem, user: string, password: string) =>
    call<void>(`/api/account/${system}`, 'PUT', { user, password }),
  deleteAccount: (system: AccountSystem) => call<void>(`/api/account/${system}`, 'DELETE'),
  updateSettings: (patch: Partial<Pick<Settings, 'syncIntervalMinutes'>>) =>
    call<Settings>('/api/settings', 'PATCH', patch),
  projects: () => call<{ projects: Project[] }>('/api/projects').then((r) => r.projects),
  setProjectHidden: (p: Project, hidden: boolean) =>
    call<Project>('/api/projects', 'PATCH', {
      applicationName: p.applicationName,
      name: p.name,
      hidden,
    }),
  setCustomerHidden: (customer: string, hidden: boolean) =>
    call<unknown>('/api/customers', 'PATCH', { customer, hidden }),
  /** null = back to the computed color. */
  setCustomerColor: (customer: string, color: string | null) =>
    call<unknown>('/api/customers', 'PATCH', { customer, color }),
};
