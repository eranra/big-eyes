import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  defaultSettings,
  isNewer,
  normalizeSettings,
  parseVersion,
  releaseUrl,
  shouldAnnounce,
  updateChannel,
} from '../src/core';
import { buildMenuModel } from '../src/main/menu-model';

describe('versions', () => {
  it('parses common forms', () => {
    expect(parseVersion('1.2.3')?.parts).toEqual([1, 2, 3]);
    expect(parseVersion('v0.10.0')?.parts).toEqual([0, 10, 0]);
    expect(parseVersion('1.2.3-beta.1')?.pre).toBe('beta.1');
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('latest')).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.2.0', '0.2.0')).toBe(false);
    expect(isNewer('0.1.9', '0.2.0')).toBe(false);
    expect(isNewer('1.0.0', '1.0.0-beta.2')).toBe(true);
    expect(isNewer('1.0.0-beta.2', '1.0.0')).toBe(false);
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.2')).toBeLessThan(0);
    expect(isNewer('garbage', '0.1.0')).toBe(false);
  });

  it('builds the release link', () => {
    expect(releaseUrl('0.3.0')).toBe('https://github.com/eranra/big-eyes/releases/tag/v0.3.0');
    expect(releaseUrl('v0.3.0')).toBe('https://github.com/eranra/big-eyes/releases/tag/v0.3.0');
  });
});

describe('update channel', () => {
  it('installs automatically on Windows and AppImage, tells the user on Mac and .deb', () => {
    expect(updateChannel({ platform: 'win32', packaged: true })).toBe('auto');
    expect(updateChannel({ platform: 'linux', packaged: true, appImage: '/home/a/Big-Eyes.AppImage' })).toBe('auto');
    expect(updateChannel({ platform: 'linux', packaged: true })).toBe('notify');
    expect(updateChannel({ platform: 'darwin', packaged: true })).toBe('notify-mac');
  });

  it('development runs never update', () => {
    expect(updateChannel({ platform: 'darwin', packaged: false })).toBe('none');
    expect(updateChannel({ platform: 'win32', packaged: false })).toBe('none');
  });
});

describe('announcing', () => {
  it('automatic checks tell about each new version once', () => {
    expect(shouldAnnounce('0.3.0', '0.2.0', null, false)).toBe(true);
    expect(shouldAnnounce('0.3.0', '0.2.0', '0.3.0', false)).toBe(false);
    expect(shouldAnnounce('0.4.0', '0.2.0', '0.3.0', false)).toBe(true);
  });

  it('a manual check always tells; nothing to tell when up to date', () => {
    expect(shouldAnnounce('0.3.0', '0.2.0', '0.3.0', true)).toBe(true);
    expect(shouldAnnounce('0.2.0', '0.2.0', null, true)).toBe(false);
  });
});

describe('update settings and menu', () => {
  it('checks automatically by default; validates the saved version', () => {
    expect(defaultSettings().checkForUpdates).toBe(true);
    expect(normalizeSettings({ lastAnnouncedVersion: '0.3.0' }).lastAnnouncedVersion).toBe('0.3.0');
    expect(normalizeSettings({ lastAnnouncedVersion: '<script>' }).lastAnnouncedVersion).toBeNull();
  });

  it('menu has About and update items; an available update is shown first', () => {
    const plain = buildMenuModel(defaultSettings(), [], [], 'darwin');
    expect(plain.find((n) => n.label === 'About Big Eyes')?.action).toEqual({ kind: 'command', command: 'about' });
    expect(plain.find((n) => n.label === 'Check for Updates…')?.action).toEqual({ kind: 'command', command: 'checkUpdates' });
    expect(plain[0]?.label).toBe('Show Eyes Now');
    const withUpdate = buildMenuModel(defaultSettings(), [], [], 'darwin', 'Update Available: 0.3.0…');
    expect(withUpdate[0]).toEqual({ label: 'Update Available: 0.3.0…', action: { kind: 'command', command: 'update' } });
    expect(withUpdate[1]?.type).toBe('separator');
  });
});

describe('release metadata', () => {
  it('reads the version from latest-mac.yml', async () => {
    const { versionFromMetadata, latestMetadataUrl } = await import('../src/core');
    expect(versionFromMetadata("version: 0.2.0\nfiles:\n  - url: Big-Eyes-0.2.0-x64.dmg\nreleaseDate: '2026-11-04'")).toBe('0.2.0');
    expect(versionFromMetadata("version: '1.4.0'\n")).toBe('1.4.0');
    expect(versionFromMetadata('files: []\n')).toBeNull();
    expect(versionFromMetadata('version: <html>\n')).toBeNull();
    expect(latestMetadataUrl('darwin')).toBe('https://github.com/eranra/big-eyes/releases/latest/download/latest-mac.yml');
    expect(latestMetadataUrl('win32')).toMatch(/\/latest\.yml$/);
    expect(latestMetadataUrl('linux')).toMatch(/\/latest-linux\.yml$/);
  });
});

describe('privacy', () => {
  it('every page blocks network access except our own files', async () => {
    const { readFileSync } = await import('node:fs');
    for (const page of ['overlay', 'settings', 'about', 'snapshot']) {
      const html = readFileSync(`src/renderer/${page}.html`, 'utf8');
      const csp = /Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(csp, page).toMatch(/default-src 'self'/);
      expect(csp, page).not.toMatch(/https?:|\*/);
    }
  });
});
