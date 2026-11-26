import { describe, expect, it } from 'vitest';
import {
  powershellTfsGet,
  latestReleases,
  readContributors,
  readWikiInfo,
  resolveTfsRepo,
  technicalLeadCell,
  type TfsGet,
} from '../src/tfs.js';

const C = 'https://tfs.boomsoftware.com/tfs/boom';
/** Responsibilities table as on the Northrail wiki (2026-11-26). */
const SECURITY_PAGE = [
  '## Responsibilities',
  '|  |  |',
  '|--|--|',
  '| **Project Manager** | @<05C9D1B4-130C-46AA-8716-FCDF1A67E9D1>|',
  '| **Technical Lead** | @<211C0E27-EE27-4BAE-B298-D7A301600A01>  |',
].join('\n');
/** Releases page as on the Northrail wiki (2026-11-26), shortened. */
const RELEASES_PAGE = [
  '⚠ Hotfix Module for Maintenance.Rail 1.3.1 needs to be removed ⚠',
  '# PROD',
  '',
  '| Date | Version | MIG | By | RailSolutions |',
  '|--|--|--|--|--|',
  '|  |  |  |  |  |',
  '|  | 1.6.6.x |  |',
  `| 2026-10-28 | [1.6.6.72213](${C}/Northrail/_build/results?buildId=72213) | | @<x> |`,
  `| 2026-11-16 | [1.6.6.73450](${C}/Northrail/_build/results?buildId=73450&view=results) | | @<x> |`,
  '| 2025-11-14 | 1.6.3.54680 | | @<y>  | 1.6.1',
  '# QS',
  '| **Date** | **Version** |',
  '|--|--|',
  `| 2026-10-23 | [1.6.7.72000](${C}/Northrail/_build/results?buildId=72000) |`,
  '# Notes',
  'no table here',
].join('\n');
const author = (name: string, email: string, date: string) => ({ author: { name, email, date } });
/** Commits on master; the same person writes the name in either order and mail in any case. */
const COMMITS = [
  author('Dorian Grantner', 'd.grantner@boomsoftware.com', '2026-11-20T08:48:57Z'),
  author('Grantner Dorian', 'D.Grantner@boomsoftware.com', '2026-11-02T10:00:00Z'),
  author('Hammer Philipp', 'p.hammer@boomsoftware.com', '2026-10-30T08:27:19Z'),
];
const PULLS = [
  { creationDate: '2026-11-03T09:00:00Z', createdBy: { id: 'HAM-ID' } },
  // Older than a month (TFS cannot filter pull requests by date).
  { creationDate: '2026-01-01T09:00:00Z', createdBy: { id: 'OLD-ID' } },
];
const identity = (id: string, name: string, account: string, mail: string, isActive = true) => ({
  id,
  providerDisplayName: name,
  isActive,
  properties: { Account: { $value: account }, Mail: { $value: mail } },
});
const repo = (project: string, name: string) => ({
  name,
  project: { name: project },
  webUrl: `${C}/${project}/_git/${name}`,
});

/** Fake TFS: answers the repository and wiki lists as TFS 5.0 does. */
function fakeTfs(): { get: TfsGet; asked: string[] } {
  const asked: string[] = [];
  const get: TfsGet = async (url) => {
    asked.push(url);
    if (url === `${C}/_apis/git/repositories?api-version=5.0`) {
      return {
        value: [repo('Northrail', 'Northrail'), repo('Northrail', 'BmmCore'), repo('X', 'BmmCore')],
      };
    }
    if (url === `${C}/Northrail/_apis/git/repositories?api-version=5.0`) {
      return { value: [repo('Northrail', 'Northrail'), repo('Northrail', 'BmmCore')] };
    }
    if (url === `${C}/Northrail/_apis/wiki/wikis?api-version=5.0`) {
      return { value: [{ name: 'Northrail.wiki', type: 'projectWiki' }] };
    }
    if (url === `${C}/X/_apis/wiki/wikis?api-version=5.0`) return { value: [] };
    const pages = `${C}/Northrail/_apis/wiki/wikis/Northrail.wiki/pages`;
    if (url === `${pages}?path=/&recursionLevel=full&api-version=5.0`) {
      return {
        path: '/',
        subPages: [
          {
            path: '/Home',
            subPages: [
              { path: '/Home/Release ToDos', subPages: [] },
              { path: '/Home/Releases', subPages: [{ path: '/Home/Releases/Archive' }] },
              { path: '/Home/Security Architecture', subPages: [] },
            ],
          },
        ],
      };
    }
    if (
      url === `${pages}?path=%2FHome%2FSecurity%20Architecture&includeContent=true&api-version=5.0`
    ) {
      return { content: SECURITY_PAGE };
    }
    if (url === `${pages}?path=%2FHome%2FReleases&includeContent=true&api-version=5.0`) {
      return { content: RELEASES_PAGE };
    }
    if (
      url ===
      `${C}/_apis/identities?identityIds=211C0E27-EE27-4BAE-B298-D7A301600A01&api-version=5.0`
    ) {
      return {
        value: [
          {
            id: '211c0e27-ee27-4bae-b298-d7a301600a01',
            providerDisplayName: 'Grantner Dorian',
            properties: { Account: { $value: 'gra' } },
          },
        ],
      };
    }
    const api = `${C}/Northrail/_apis/git/repositories/Northrail`;
    if (url === `${api}?api-version=5.0`) return { defaultBranch: 'refs/heads/master' };
    if (
      url.startsWith(
        `${api}/commits?searchCriteria.itemVersion.version=master&searchCriteria.fromDate=`,
      )
    ) {
      return { value: COMMITS };
    }
    if (
      url ===
      `${api}/pullrequests?searchCriteria.status=all&searchCriteria.targetRefName=refs%2Fheads%2Fmaster&$top=300&api-version=5.0`
    ) {
      return { value: PULLS };
    }
    if (url === `${C}/_apis/identities?identityIds=HAM-ID&api-version=5.0`) {
      return { value: [identity('HAM-ID', 'Hammer Philipp', 'ham', 'p.hammer@boomsoftware.com')] };
    }
    if (
      url ===
      `${C}/_apis/identities?searchFilter=MailAddress&filterValue=d.grantner%40boomsoftware.com&api-version=5.0`
    ) {
      // An old, inactive account with the same mail: the active one wins.
      return {
        value: [
          identity('OLD', 'Grantner Dorian', 'dgr', 'd.grantner@boomsoftware.com', false),
          identity('GRA-ID', 'Grantner Dorian', 'gra', 'd.grantner@boomsoftware.com'),
        ],
      };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { get, asked };
}

const northrail = {
  repoUrl: `${C}/Northrail/_git/Northrail`,
  wikiUrl: `${C}/Northrail/_wiki/wikis/Northrail.wiki`,
  technicalLead: 'Grantner Dorian (GRA)',
  releases: [
    {
      system: 'PROD',
      version: '1.6.6.73450',
      date: '2026-11-16',
      url: `${C}/Northrail/_build/results?buildId=73450&view=results`,
    },
    {
      system: 'QS',
      version: '1.6.7.72000',
      date: '2026-10-23',
      url: `${C}/Northrail/_build/results?buildId=72000`,
    },
  ],
  contributors: [
    {
      name: 'Grantner Dorian',
      account: 'GRA',
      commits: 2,
      pullRequests: 0,
      lastAt: '2026-11-20T08:48:57Z',
    },
    {
      name: 'Hammer Philipp',
      account: 'HAM',
      commits: 1,
      pullRequests: 1,
      lastAt: '2026-11-03T09:00:00Z',
    },
  ],
};

describe('resolveTfsRepo', () => {
  it('completes the short form with the project and finds the project wiki', async () => {
    const now = new Date('2026-11-26T09:00:00Z');
    expect(await resolveTfsRepo(`${C}/_git/Northrail`, fakeTfs().get, undefined, now)).toEqual(
      northrail,
    );
  });

  it('takes the full form (any page in the repo) as is', async () => {
    const { get, asked } = fakeTfs();
    const now = new Date('2026-11-26T09:00:00Z');
    expect(
      await resolveTfsRepo(`${C}/Northrail/_git/Northrail?path=/src`, get, undefined, now),
    ).toEqual(northrail);
    expect(asked[0]).toBe(`${C}/Northrail/_apis/git/repositories?api-version=5.0`);
  });

  it('refuses TFVC, other servers, ambiguous and unknown repos', async () => {
    const { get, asked } = fakeTfs();
    await expect(resolveTfsRepo(`${C}/Northrail/_versionControl`, get)).rejects.toThrow('TFVC');
    await expect(resolveTfsRepo('https://evil.example/tfs/boom/_git/X', get)).rejects.toThrow(
      'Nur Links auf',
    );
    expect(asked).toEqual([]); // the Windows login never went anywhere
    await expect(resolveTfsRepo(`${C}/_git/BmmCore`, get)).rejects.toThrow('mehreren Projekten');
    await expect(resolveTfsRepo(`${C}/_git/Nope`, get)).rejects.toThrow('nicht gefunden');
    await expect(resolveTfsRepo(`${C}/Northrail/_wiki`, get)).rejects.toThrow('Kein TFS-Git-Link');
  });

  it('never sends the Windows login to another server', async () => {
    await expect(powershellTfsGet('https://evil.example/x')).rejects.toThrow('fremder Server');
  });
});
describe('technical lead (TV)', () => {
  it('reads the Technical Lead row of the responsibilities table', () => {
    expect(technicalLeadCell(SECURITY_PAGE)).toBe('@<211C0E27-EE27-4BAE-B298-D7A301600A01>');
    expect(technicalLeadCell('| Technical Lead | Max Muster |')).toBe('Max Muster');
    expect(technicalLeadCell('| **Technical Lead** |  |')).toBeNull();
    expect(technicalLeadCell('# no table')).toBeNull();
  });

  it('finds both pages in the wiki and names the mentioned person', async () => {
    const wiki = `${C}/Northrail/_wiki/wikis/Northrail.wiki`;
    expect(await readWikiInfo(wiki, fakeTfs().get)).toEqual({
      technicalLead: northrail.technicalLead,
      releases: northrail.releases,
    });
  });

  it('takes the newest dated row per system heading', () => {
    expect(latestReleases(RELEASES_PAGE)).toEqual(northrail.releases);
    expect(latestReleases('# PROD\n| a | b |\n| 2026-01-01 | 1.0 |')).toEqual([]);
  });

  it('leaves TV and releases empty when the wiki has neither page', async () => {
    const get: TfsGet = async () => ({ path: '/', subPages: [{ path: '/Home', subPages: [] }] });
    expect(await readWikiInfo(`${C}/X/_wiki/wikis/X.wiki`, get)).toEqual({
      technicalLead: null,
      releases: [],
    });
  });
});
describe('readContributors', () => {
  it('counts master commits and pull requests per person (by mail), latest first', async () => {
    const since = new Date('2026-10-26T09:00:00Z');
    const people = await readContributors(`${C}/Northrail/_git/Northrail`, fakeTfs().get, since);
    expect(people).toEqual(northrail.contributors);
  });
});
