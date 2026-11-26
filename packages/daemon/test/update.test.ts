import { describe, expect, it } from 'vitest';
import { isNewer, LATEST_RELEASE_URL, updateChecker } from '../src/update.js';

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/AmIHang/BRSSupporter/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

describe('update check', () => {
  it('compares versions numerically', () => {
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('0.3.0', '0.2.1')).toBe(true);
    expect(isNewer('0.2.1', '0.2.1')).toBe(false);
    expect(isNewer('0.2', '0.2.0')).toBe(false);
    expect(isNewer('0.2.0', '0.10.0')).toBe(false);
  });

  it('reports a newer release and asks GitHub only once per period', async () => {
    let t = 0;
    const asked: string[] = [];
    let answer: unknown = release('v0.3.0');
    const check = updateChecker('0.2.1', {
      fetchJson: async (url) => {
        asked.push(url);
        return answer;
      },
      ttlMs: 1000,
      now: () => t,
    });
    expect(await check()).toEqual({
      current: '0.2.1',
      latest: '0.3.0',
      url: 'https://github.com/AmIHang/BRSSupporter/releases/tag/v0.3.0',
      available: true,
    });
    await check();
    expect(asked).toEqual([LATEST_RELEASE_URL]);

    // After the period: same version as installed, nothing to update.
    t = 2000;
    answer = release('v0.2.1');
    expect(await check()).toMatchObject({ latest: '0.2.1', available: false });
    // Drafts and pre-releases are not offered.
    t = 4000;
    answer = release('v0.4.0', { prerelease: true });
    expect((await check()).available).toBe(false);
  });

  it('answers "unknown" when GitHub cannot be asked, and nothing foreign as link', async () => {
    const failing = updateChecker('0.2.1', {
      fetchJson: async () => {
        throw new Error('offline');
      },
    });
    expect(await failing()).toEqual({
      current: '0.2.1',
      latest: null,
      url: null,
      available: false,
    });
    const foreign = updateChecker('0.2.1', {
      fetchJson: async () => release('v9.0.0', { html_url: 'https://evil.example/x' }),
    });
    expect((await foreign()).available).toBe(false);
  });
});
