import { z } from 'zod';

/** Latest published release of BRSSupporter (public, no login). */
export const LATEST_RELEASE_URL =
  'https://api.github.com/repos/AmIHang/BRSSupporter/releases/latest';

export interface UpdateInfo {
  current: string;
  /** Newest released version, null when it could not be checked. */
  latest: string | null;
  /** Release page to download it from. */
  url: string | null;
  available: boolean;
}

export type FetchJson = (url: string) => Promise<unknown>;

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url, {
    // GitHub requires a User-Agent; a generic one, nothing about the user.
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BRSSupporter' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub: HTTP ${res.status}`);
  return res.json();
};

const releaseSchema = z.object({
  tag_name: z.string().regex(/^v?\d+(\.\d+){0,3}$/),
  html_url: z.url({ protocol: /^https$/, hostname: /^github\.com$/ }),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
});

/** a > b for versions like "0.10.2" (numeric parts, missing parts are 0). */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * Checks GitHub for a newer release, at most every `ttlMs` (default 6 h); concurrent callers
 * share one request. A failed check answers "unknown" (latest null) and is retried after a minute.
 */
export function updateChecker(
  current: string,
  options: { fetchJson?: FetchJson; ttlMs?: number; now?: () => number } = {},
): () => Promise<UpdateInfo> {
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const ttlMs = options.ttlMs ?? 6 * 60 * 60_000;
  const now = options.now ?? Date.now;
  let cached: { until: number; info: UpdateInfo } | null = null;
  let running: Promise<UpdateInfo> | null = null;

  const check = async (): Promise<UpdateInfo> => {
    try {
      const r = releaseSchema.parse(await fetchJson(LATEST_RELEASE_URL));
      const latest = r.tag_name.replace(/^v/, '');
      const info = {
        current,
        latest,
        url: r.html_url,
        available: !r.draft && !r.prerelease && isNewer(latest, current),
      };
      cached = { until: now() + ttlMs, info };
      return info;
    } catch {
      const info = { current, latest: null, url: null, available: false };
      cached = { until: now() + 60_000, info };
      return info;
    }
  };

  return () => {
    if (cached && now() < cached.until) return Promise.resolve(cached.info);
    running ??= check().finally(() => {
      running = null;
    });
    return running;
  };
}
