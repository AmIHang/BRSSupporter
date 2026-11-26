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
  /** OTMA ticket of the main work package (looked up while new or in process). */
  otmaNumber: string | null;
  /** "Verantwortlich" of the OTMA ticket, refreshed with every sync while in process. */
  otmaResponsible: string | null;
  /** Status of the OTMA ticket, refreshed with the responsible person. */
  otmaStatus: string | null;
  customer: string | null;
  /** Chosen color of the customer; null = computed (lib/colors.ts). */
  customerColor: string | null;
  /** Wiki and TV ("Technical Lead") of the project's repository, else the customer's. */
  wikiUrl: string | null;
  technicalLead: string | null;
  /** Latest release per system (heading on the wiki's Releases page). */
  releases: Release[];
  /** Who committed to or opened pull requests into the default branch in the last month. */
  contributors: Contributor[];
  /** Affected installation from BSM, e.g. "PROD". */
  installation: string | null;
}

export interface Contributor {
  name: string;
  /** Windows account in capitals, e.g. "GRA". */
  account: string | null;
  /** Commits on the default branch (main/master). */
  commits: number;
  pullRequests: number;
  /** ISO time */
  lastAt: string;
}

export interface Release {
  system: string;
  version: string;
  /** YYYY-MM-DD */
  date: string;
  url: string | null;
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
  /** Error of the OTMA part of the last sync. */
  otmaError: string | null;
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
  /** TFS Git repository of the project itself (with its wiki); null = the customer's applies. */
  repoUrl: string | null;
  wikiUrl: string | null;
  customerRepoUrl: string | null;
  customerWikiUrl: string | null;
  technicalLead: string | null;
  customerTechnicalLead: string | null;
  /** The project's own repository, else the customer's; wiki and TV go with it. */
  effectiveRepoUrl: string | null;
  effectiveWikiUrl: string | null;
  effectiveTechnicalLead: string | null;
}

/** A repository link as the daemon stored it: completed, with its project's wiki. */
export interface RepoLink {
  repoUrl: string;
  wikiUrl: string | null;
  technicalLead: string | null;
  releases: Release[];
  contributors: Contributor[];
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

export interface UpdateInfo {
  current: string;
  /** Newest release on GitHub; null = could not be checked. */
  latest: string | null;
  /** Its release page. */
  url: string | null;
  available: boolean;
}

export const api = {
  /** Installed version ("dev" when the daemon was started by hand). */
  version: () => call<{ version: string }>('/api/health').then((r) => r.version),
  update: () => call<UpdateInfo>('/api/update'),
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
  updateSettings: (patch: Partial<Omit<Settings, 'bsmFilter'>>) =>
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
  /** null = no link (projects without their own have none either). */
  setCustomerRepoUrl: (customer: string, repoUrl: string | null) =>
    call<{ repo: RepoLink | null }>('/api/customers', 'PATCH', { customer, repoUrl }).then(
      (r) => r.repo,
    ),
  /** null = the customer's link applies. */
  setProjectRepoUrl: (p: Project, repoUrl: string | null) =>
    call<{ repo: RepoLink | null }>('/api/projects', 'PATCH', {
      applicationName: p.applicationName,
      name: p.name,
      repoUrl,
    }).then((r) => r.repo),
  /** null = back to the computed color. */
  setCustomerColor: (customer: string, color: string | null) =>
    call<unknown>('/api/customers', 'PATCH', { customer, color }),
};
