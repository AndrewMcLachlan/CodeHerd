import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdate, compareVersions } from './update-checker';

describe('compareVersions', () => {
  it('compares numeric cores', () => {
    expect(compareVersions('0.10.1', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.11.0', '0.11.0')).toBe(0);
    expect(compareVersions('0.11.0', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0); // missing segments are 0
  });

  it('ranks a release above its own prereleases', () => {
    expect(compareVersions('1.0.0', '1.0.0-beta1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc1', '1.0.0')).toBeLessThan(0);
  });

  it('orders prereleases by stage: alpha < beta < rc', () => {
    expect(compareVersions('1.0.0-beta1', '1.0.0-alpha1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc1', '1.0.0-beta9')).toBeGreaterThan(0);
  });

  it('orders same-stage prereleases numerically, including past 9', () => {
    expect(compareVersions('1.0.0-beta2', '1.0.0-beta1')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta10', '1.0.0-beta2')).toBeGreaterThan(0); // not lexical
    expect(compareVersions('1.0.0-beta2', '1.0.0-beta2')).toBe(0);
  });

  it('treats a bare stage as earlier than its numbered form', () => {
    expect(compareVersions('1.0.0-beta1', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('lets the core dominate regardless of prerelease tags', () => {
    expect(compareVersions('1.0.0-beta1', '0.11.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.1-beta1', '1.0.0')).toBeGreaterThan(0);
  });
});

describe('checkForUpdate', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ok = (json: unknown) => ({ ok: true, json: async () => json });

  it('uses the latest stable release for a stable current version', async () => {
    fetchMock.mockResolvedValue(ok({ tag_name: 'v1.0.0', html_url: 'https://github.com/x/y/releases/tag/v1.0.0' }));

    const update = await checkForUpdate('0.11.0');
    expect(fetchMock.mock.calls[0][0]).toContain('/releases/latest');
    expect(update).toMatchObject({ version: '1.0.0' });
  });

  it('returns null when the latest stable is not newer', async () => {
    fetchMock.mockResolvedValue(ok({ tag_name: 'v0.11.0', html_url: 'https://example' }));
    expect(await checkForUpdate('0.11.0')).toBeNull();
  });

  it('scans the full release list when running a prerelease', async () => {
    fetchMock.mockResolvedValue(ok([
      { tag_name: 'v0.11.0', html_url: 'https://github.com/x/y/releases/tag/v0.11.0', draft: false, prerelease: false },
      { tag_name: 'v1.0.0-beta2', html_url: 'https://github.com/x/y/releases/tag/v1.0.0-beta2', draft: false, prerelease: true },
    ]));

    const update = await checkForUpdate('1.0.0-beta1');
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/releases\?/);
    expect(update).toMatchObject({ version: '1.0.0-beta2' });
  });

  it('prefers the final release over a newer-tagged beta when both exist', async () => {
    fetchMock.mockResolvedValue(ok([
      { tag_name: 'v1.0.0', html_url: 'https://example/1.0.0', draft: false, prerelease: false },
      { tag_name: 'v1.0.0-beta3', html_url: 'https://example/beta3', draft: false, prerelease: true },
    ]));

    expect(await checkForUpdate('1.0.0-beta1')).toMatchObject({ version: '1.0.0' });
  });

  it('ignores draft releases', async () => {
    fetchMock.mockResolvedValue(ok([
      { tag_name: 'v1.0.0-beta2', html_url: 'https://example', draft: true, prerelease: true },
    ]));

    expect(await checkForUpdate('1.0.0-beta1')).toBeNull();
  });

  it('returns null for a prerelease build with nothing newer', async () => {
    fetchMock.mockResolvedValue(ok([
      { tag_name: 'v1.0.0-beta1', html_url: 'https://example', draft: false, prerelease: true },
      { tag_name: 'v0.11.0', html_url: 'https://example', draft: false, prerelease: false },
    ]));

    expect(await checkForUpdate('1.0.0-beta1')).toBeNull();
  });

  it('fails silently on network errors and bad responses', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await checkForUpdate('0.11.0')).toBeNull();

    fetchMock.mockResolvedValueOnce({ ok: false });
    expect(await checkForUpdate('0.11.0')).toBeNull();

    fetchMock.mockResolvedValueOnce(ok({}));
    expect(await checkForUpdate('0.11.0')).toBeNull();
  });
});
