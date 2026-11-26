import { execFile } from 'node:child_process';
import { z } from 'zod';

/** The only TFS the Windows login is ever sent to. */
export const TFS_ORIGIN = 'https://tfs.boomsoftware.com';
const API = 'api-version=5.0';

/** GET of a TFS REST URL with the Windows login; resolves to the parsed JSON. */
export type TfsGet = (url: string) => Promise<unknown>;

/**
 * TfsGet through Windows PowerShell (Invoke-RestMethod -UseDefaultCredentials): Node has no
 * Windows integrated auth of its own. The URL travels in the environment, never in the script.
 */
export const powershellTfsGet: TfsGet = (url) => {
  if (!url.startsWith(`${TFS_ORIGIN}/`)) return Promise.reject(new Error('TFS: fremder Server'));
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Invoke-RestMethod -Uri $env:BRS_TFS_URL -UseDefaultCredentials | ConvertTo-Json -Depth 20 -Compress`;
  return new Promise((resolve, reject) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      {
        env: { ...process.env, BRS_TFS_URL: url },
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 20 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message).split('\n')[0]!.trim().slice(0, 300);
          return reject(new Error(`TFS: ${msg}`));
        }
        try {
          resolve(JSON.parse(stdout) as unknown);
        } catch {
          reject(new Error('TFS: unerwartete Antwort'));
        }
      },
    ),
  );
};

const reposSchema = z.object({
  value: z.array(
    z.looseObject({
      name: z.string(),
      webUrl: z.string(),
      project: z.looseObject({ name: z.string() }),
    }),
  ),
});
const wikisSchema = z.object({
  value: z.array(z.looseObject({ name: z.string(), type: z.string() })),
});

/** Latest release of one system (heading on the Releases page, e.g. "PROD", "QS"). */
export interface Release {
  system: string;
  version: string;
  /** As written on the page, YYYY-MM-DD. */
  date: string;
  /** Link of the version cell (usually the build); null = plain text. */
  url: string | null;
}

/** What BRSSupporter reads from a project wiki. */
export interface WikiInfo {
  /** "Technical Lead" (TV) from the Security Architecture page; null = not found. */
  technicalLead: string | null;
  /** Latest release per system from the Releases page; [] = no page or no release. */
  releases: Release[];
}

/** Someone active in a repository in the last month (default branch: commits, pull requests). */
export interface Contributor {
  name: string;
  /** Windows account in capitals (matches the OTMA short names), e.g. "GRA"; null = unknown. */
  account: string | null;
  /** Commits on the default branch. */
  commits: number;
  pullRequests: number;
  /** Latest activity, ISO time. */
  lastAt: string;
}

/** Everything read about a repository: its wiki and who worked in it lately. */
export interface RepoInfo extends WikiInfo {
  contributors: Contributor[];
}

export interface TfsRepo extends RepoInfo {
  /** Full Git link: <collection>/<project>/_git/<repo>. */
  repoUrl: string;
  /** The project's wiki (all pages); null when the project has none. */
  wikiUrl: string | null;
}

const enc = encodeURIComponent;
const NO_REPO_INFO: RepoInfo = { technicalLead: null, releases: [], contributors: [] };

/**
 * Checks a Git repository link and completes it: the short form <collection>/_git/<repo> gets its
 * project, and the project's wiki is looked up and read. TFVC (_versionControl) is old code:
 * refused.
 */
export async function resolveTfsRepo(
  input: string,
  get: TfsGet,
  log: (msg: string) => void = () => undefined,
  now = new Date(),
): Promise<TfsRepo> {
  const url = new URL(input);
  if (url.origin !== TFS_ORIGIN) throw new Error(`Nur Links auf ${TFS_ORIGIN} sind erlaubt`);
  const path = decodeURIComponent(url.pathname);
  if (/\/_versionControl\b/i.test(path)) {
    throw new Error('TFVC-Links (_versionControl) sind alter Code – bitte den Git-Link angeben');
  }
  // /tfs/<collection>[/<project>]/_git/<repo>[/...]
  const m = /^\/tfs\/([^/]+)(?:\/([^/]+))?\/_git\/([^/]+)/i.exec(path);
  if (!m) throw new Error('Kein TFS-Git-Link (…/tfs/<Collection>/<Projekt>/_git/<Repo>)');
  const collection = `${TFS_ORIGIN}/tfs/${enc(m[1]!)}`;
  const [, , project, repo] = m;

  const scope = project ? `${collection}/${enc(project)}` : collection;
  const repos = reposSchema
    .parse(await get(`${scope}/_apis/git/repositories?${API}`))
    .value.filter((r) => r.name.toLowerCase() === repo!.toLowerCase());
  if (repos.length === 0) throw new Error(`Repo ${repo} nicht gefunden`);
  if (repos.length > 1) {
    const projects = repos.map((r) => r.project.name).join(', ');
    throw new Error(
      `Repo ${repo} gibt es in mehreren Projekten (${projects}) – bitte vollständigen Link`,
    );
  }
  const found = repos[0]!;

  const projectUrl = `${collection}/${enc(found.project.name)}`;
  const wikis = wikisSchema.parse(await get(`${projectUrl}/_apis/wiki/wikis?${API}`)).value;
  const wiki = wikis.find((w) => w.type === 'projectWiki') ?? wikis[0];
  const wikiUrl = wiki ? `${projectUrl}/_wiki/wikis/${enc(wiki.name)}` : null;
  // The link is fine even when wiki or history cannot be read; the hourly refresh tries again.
  const info = await readRepoInfo(found.webUrl, wikiUrl, get, now).catch((err: unknown) => {
    log(`repo ${found.webUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return NO_REPO_INFO;
  });
  return { repoUrl: found.webUrl, wikiUrl, ...info };
}

const pageSchema = z.object({ content: z.string().nullish() });
const identitiesSchema = z.object({
  value: z.array(
    z.looseObject({
      id: z.string(),
      providerDisplayName: z.string(),
      properties: z
        .looseObject({ Account: z.looseObject({ $value: z.string() }).optional() })
        .optional(),
    }),
  ),
});

/** All page paths of a wiki page tree (as TFS answers pages?recursionLevel=full). */
function pagePaths(page: unknown): string[] {
  const p = page as { path?: unknown; subPages?: unknown } | null;
  const own = typeof p?.path === 'string' ? [p.path] : [];
  const subs = Array.isArray(p?.subPages) ? p.subPages : [];
  return [...own, ...subs.flatMap(pagePaths)];
}

/**
 * Cell of the "Technical Lead" row of a markdown table, e.g.
 * `| **Technical Lead** | @<211C0E27-…>  |`; null when the page has no such row.
 */
export function technicalLeadCell(markdown: string): string | null {
  const row = /^\s*\|\s*\**\s*Technical Lead\s*\**\s*\|([^|\n]*)/im.exec(markdown);
  const cell = row?.[1]?.trim();
  return cell ? cell : null;
}

/** Cells of a markdown table row ("| a | b |" → ["a", "b"]). */
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');

/**
 * Latest release per system of a Releases page: every heading ("# PROD") starts a system, its
 * table needs "Date" and "Version" columns; the row with the newest YYYY-MM-DD date wins.
 */
export function latestReleases(markdown: string): Release[] {
  const latest = new Map<string, Release>();
  let system = '';
  let columns: { date: number; version: number } | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^\s*#+\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      system = heading[1]!.replace(/[*_`]/g, '').trim();
      columns = null;
      continue;
    }
    if (!line.trim().startsWith('|')) continue;
    const row = cells(line).map((c) => c.trim());
    const names = row.map((c) => c.replace(/[*_`]/g, '').toLowerCase());
    if (names.includes('date') && names.includes('version')) {
      columns = { date: names.indexOf('date'), version: names.indexOf('version') };
      continue;
    }
    const date = columns && /\b(\d{4}-\d{2}-\d{2})\b/.exec(row[columns.date] ?? '')?.[1];
    const cell = columns && row[columns.version];
    if (!system || !date || !cell) continue;
    const link = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(cell);
    const version = (link ? link[1]! : cell).replace(/[*_`]/g, '').trim();
    if (!version) continue;
    const before = latest.get(system);
    if (!before || date > before.date) {
      latest.set(system, { system, version, date, url: link ? link[2]! : null });
    }
  }
  return [...latest.values()];
}

/**
 * TV and latest releases from a project wiki: "Technical Lead" on the Security Architecture
 * page (TFS mentions @<identity id> become "Name (ACCOUNT)") and the Releases page. Pages are
 * found on any level; a missing page only leaves its part empty.
 */
export async function readWikiInfo(wikiUrl: string, get: TfsGet): Promise<WikiInfo> {
  const m = /^(.*\/tfs\/[^/]+)(\/[^/]+)\/_wiki\/wikis\/([^/]+)$/.exec(wikiUrl);
  if (!m) throw new Error(`Kein TFS-Wiki-Link: ${wikiUrl}`);
  const [, collection, project, wiki] = m;
  const pages = `${collection}${project}/_apis/wiki/wikis/${wiki}/pages`;
  const paths = pagePaths(await get(`${pages}?path=/&recursionLevel=full&${API}`));
  const content = async (name: string) => {
    const path = paths.find((p) => p.split('/').at(-1)!.replace(/-/g, ' ').toLowerCase() === name);
    if (!path) return '';
    const page = await get(`${pages}?path=${enc(path)}&includeContent=true&${API}`);
    return pageSchema.parse(page).content ?? '';
  };

  const releases = latestReleases(await content('releases'));
  const cell = technicalLeadCell(await content('security architecture'));
  if (!cell) return { technicalLead: null, releases };
  const ids = [...cell.matchAll(/@<([0-9a-f-]{36})>/gi)].map((x) => x[1]!);
  if (!ids.length) return { technicalLead: cell.replace(/[*_`]/g, '').trim() || null, releases };
  const found = identitiesSchema.parse(
    await get(`${collection}/_apis/identities?identityIds=${ids.join(',')}&${API}`),
  ).value;
  const technicalLead = ids
    .map((id) => {
      const i = found.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (!i) return id;
      const account = i.properties?.Account?.$value;
      return account
        ? `${i.providerDisplayName} (${account.toUpperCase()})`
        : i.providerDisplayName;
    })
    .join(', ');
  return { technicalLead, releases };
}

const repoSchema = z.looseObject({ defaultBranch: z.string().nullish() });
const commitsSchema = z.object({
  value: z.array(
    z.looseObject({
      author: z.looseObject({ name: z.string(), email: z.string(), date: z.string() }),
    }),
  ),
});
const pullRequestsSchema = z.object({
  value: z.array(
    z.looseObject({ creationDate: z.string(), createdBy: z.looseObject({ id: z.string() }) }),
  ),
});
const mailIdentitiesSchema = z.object({
  value: z.array(
    z.looseObject({
      id: z.string(),
      providerDisplayName: z.string(),
      isActive: z.boolean().nullish(),
      properties: z
        .looseObject({
          Account: z.looseObject({ $value: z.string() }).optional(),
          Mail: z.looseObject({ $value: z.string() }).optional(),
        })
        .optional(),
    }),
  ),
});

/** How far back "lately" goes for the contributors. */
const CONTRIBUTOR_DAYS = 31;

/**
 * Who committed to the repository's default branch (main/master) or opened a pull request into it
 * since `since`. People are matched by mail address (commit author names differ in order);
 * name and Windows account come from TFS identities. Latest activity first.
 */
export async function readContributors(
  repoUrl: string,
  get: TfsGet,
  since: Date,
): Promise<Contributor[]> {
  const m = /^(.*\/tfs\/[^/]+)(\/[^/]+)\/_git\/([^/?#]+)/.exec(repoUrl);
  if (!m) throw new Error(`Kein TFS-Git-Link: ${repoUrl}`);
  const [, collection, project, repo] = m;
  const api = `${collection}${project}/_apis/git/repositories/${repo}`;
  const branch = repoSchema.parse(await get(`${api}?${API}`)).defaultBranch;
  if (!branch) return [];
  const from = since.toISOString();
  const commits = commitsSchema.parse(
    await get(
      `${api}/commits?searchCriteria.itemVersion.version=${enc(branch.replace(/^refs\/heads\//, ''))}` +
        `&searchCriteria.fromDate=${enc(from)}&searchCriteria.$top=1000&${API}`,
    ),
  ).value;
  // TFS 5.0 has no date filter for pull requests: the latest few hundred, filtered here.
  const pulls = pullRequestsSchema
    .parse(
      await get(
        `${api}/pullrequests?searchCriteria.status=all&searchCriteria.targetRefName=${enc(branch)}` +
          `&$top=300&${API}`,
      ),
    )
    .value.filter((p) => p.creationDate >= from);

  type Identity = z.infer<typeof mailIdentitiesSchema>['value'][number];
  const mailOf = (i: Identity) => i.properties?.Mail?.$value.toLowerCase();
  // Several identities can share a mail address (old accounts): the active one wins.
  const pick = (found: Identity[]) => found.find((i) => i.isActive) ?? found[0];
  const prIds = [...new Set(pulls.map((p) => p.createdBy.id))];
  const prPeople = prIds.length
    ? mailIdentitiesSchema.parse(
        await get(`${collection}/_apis/identities?identityIds=${prIds.join(',')}&${API}`),
      ).value
    : [];
  const byMail = new Map<string, Identity>();
  for (const i of prPeople) if (mailOf(i)) byMail.set(mailOf(i)!, i);
  for (const mail of new Set(commits.map((c) => c.author.email.toLowerCase()))) {
    if (byMail.has(mail)) continue;
    const found = mailIdentitiesSchema.parse(
      await get(
        `${collection}/_apis/identities?searchFilter=MailAddress&filterValue=${enc(mail)}&${API}`,
      ),
    ).value;
    const i = pick(found);
    if (i) byMail.set(mail, i);
  }

  const people = new Map<string, Contributor>();
  const add = (key: string, fallbackName: string, at: string, pr: boolean) => {
    const i = byMail.get(key);
    const p = people.get(key) ?? {
      name: i?.providerDisplayName ?? fallbackName,
      account: i?.properties?.Account?.$value.toUpperCase() ?? null,
      commits: 0,
      pullRequests: 0,
      lastAt: at,
    };
    if (pr) p.pullRequests++;
    else p.commits++;
    if (at > p.lastAt) p.lastAt = at;
    people.set(key, p);
  };
  for (const c of commits) add(c.author.email.toLowerCase(), c.author.name, c.author.date, false);
  for (const p of pulls) {
    const i = prPeople.find((x) => x.id.toLowerCase() === p.createdBy.id.toLowerCase());
    if (i) add(mailOf(i) ?? i.id, i.providerDisplayName, p.creationDate, true);
  }
  return [...people.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

/** Wiki (TV, releases; none without wiki) and contributors of the last month of a repository. */
export async function readRepoInfo(
  repoUrl: string,
  wikiUrl: string | null,
  get: TfsGet,
  now = new Date(),
): Promise<RepoInfo> {
  const wiki = wikiUrl ? await readWikiInfo(wikiUrl, get) : NO_REPO_INFO;
  const since = new Date(now.getTime() - CONTRIBUTOR_DAYS * 86_400_000);
  return {
    technicalLead: wiki.technicalLead,
    releases: wiki.releases,
    contributors: await readContributors(repoUrl, get, since),
  };
}
