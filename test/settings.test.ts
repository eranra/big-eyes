import { describe, expect, it } from 'vitest';
import { defaultSettings, matchingTheme, mergeSettings, normalizeSettings, selectDisplays, THEMES, type DisplayInfo } from '../src/core';

describe('defaults', () => {
  it('match the out-of-the-box experience', () => {
    const d = defaultSettings();
    expect(d.idleTimeout).toBe(30);
    expect(d.screens).toEqual({ mode: 'builtin' });
    expect(d.cameras).toEqual({ mode: 'builtin' });
    expect(d.mood.smileBack).toBe(true);
    expect(d.look.showMouth).toBe(true);
    expect(d.showCaptions).toBe(false);
    expect(matchingTheme(d)).toBe('classic');
  });
});

describe('look settings', () => {
  it('validates look values', () => {
    const s = normalizeSettings({
      look: { scleraColor: 'white', irisStyle: 'laser', eyeShape: 'wide', pupilSize: 9, showBrows: 'yes', spacing: 1.2 },
    });
    expect(s.look.scleraColor).toBe(defaultSettings().look.scleraColor);
    expect(s.look.irisStyle).toBe('detailed');
    expect(s.look.eyeShape).toBe('wide');
    expect(s.look.pupilSize).toBe(1.6);
    expect(s.look.showBrows).toBe(true);
    expect(s.look.spacing).toBe(1.2);
  });

  it('merges one look value without losing the others', () => {
    const s = mergeSettings(defaultSettings(), { look: { lidColor: '#112233' } });
    expect(s.look.lidColor).toBe('#112233');
    expect(s.look.browColor).toBe(defaultSettings().look.browColor);
    expect(matchingTheme(s)).toBeNull();
  });

  it('every theme is valid and recognized', () => {
    for (const t of THEMES) {
      const s = mergeSettings(defaultSettings(), { irisColor: t.irisColor, look: t.look });
      expect(s.look).toEqual(t.look);
      expect(matchingTheme(s)).toBe(t.id);
    }
  });
});

describe('camera settings', () => {
  it('converts 0.1.0 settings files', () => {
    expect(normalizeSettings({ cameraKind: 'builtin', cameraId: null, cameraLabel: null }).cameras).toEqual({ mode: 'builtin' });
    expect(normalizeSettings({ cameraKind: 'default', cameraId: null, cameraLabel: null }).cameras).toEqual({ mode: 'default' });
    expect(normalizeSettings({ cameraKind: 'builtin', cameraId: 'x1', cameraLabel: 'HD Pro Webcam C920' }).cameras).toEqual({
      mode: 'selected',
      cameras: [{ id: 'x1', label: 'HD Pro Webcam C920' }],
    });
    expect('cameraId' in normalizeSettings({ cameraId: 'x' })).toBe(false);
  });

  it('validates the camera list', () => {
    const s = normalizeSettings({
      cameras: { mode: 'selected', cameras: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A again' }, { id: 5 }, 'x', { id: '', label: 'B' }] },
    });
    expect(s.cameras).toEqual({ mode: 'selected', cameras: [{ id: 'a', label: 'A' }, { id: '', label: 'B' }] });
    expect(normalizeSettings({ cameras: { mode: 'selected', cameras: [] } }).cameras).toEqual({ mode: 'builtin' });
    expect(normalizeSettings({ cameras: { mode: 'all' } }).cameras).toEqual({ mode: 'all' });
    expect(normalizeSettings({ cameras: { mode: 'many' } }).cameras).toEqual({ mode: 'builtin' });
  });
});

describe('settings validation', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings('x')).toEqual(defaultSettings());
    expect(normalizeSettings({ idleTimeout: 'soon', eyeSize: NaN })).toEqual(defaultSettings());
  });

  it('clamps numbers and validates fields', () => {
    const s = normalizeSettings({
      idleTimeout: 1,
      eyeSize: 99,
      backgroundDim: -1,
      irisColor: 'red',
      welcomeText: 'x'.repeat(100),
      screens: { mode: 'selected', ids: [3, 3, 'a', 4.5, 7] },
      unknownKey: true,
    });
    expect(s.idleTimeout).toBe(5);
    expect(s.eyeSize).toBe(2.5);
    expect(normalizeSettings({ eyeSize: 0.01 }).eyeSize).toBe(0.2);
    expect(s.backgroundDim).toBe(0);
    expect(s.irisColor).toBe(defaultSettings().irisColor);
    expect(s.welcomeText).toHaveLength(40);
    expect(s.screens).toEqual({ mode: 'selected', ids: [3, 7] });
    expect('unknownKey' in s).toBe(false);
  });

  it('rejects an empty screen selection', () => {
    expect(normalizeSettings({ screens: { mode: 'selected', ids: [] } }).screens).toEqual({ mode: 'builtin' });
    expect(normalizeSettings({ screens: { mode: 'weird' } }).screens).toEqual({ mode: 'builtin' });
  });

  it('round-trips through JSON', () => {
    const s = mergeSettings(defaultSettings(), {
      eyeSize: 1.35,
      cameras: { mode: 'selected', cameras: [{ id: 'abc', label: 'Cam' }] },
      screens: { mode: 'primary' },
    });
    expect(normalizeSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('merges nested values without losing siblings', () => {
    const s = mergeSettings(defaultSettings(), { attention: { reference: { yaw: 7 } }, mood: { awayToBored: 4 } });
    expect(s.attention.reference.yaw).toBe(7);
    expect(s.attention.reference.pitch).toBe(defaultSettings().attention.reference.pitch);
    expect(s.attention.yawTolerance).toBe(defaultSettings().attention.yawTolerance);
    expect(s.mood.awayToBored).toBe(4);
    expect(s.mood.happyHold).toBe(defaultSettings().mood.happyHold);
    expect(mergeSettings(s, 'nope')).toBe(s);
  });
});

describe('selectDisplays', () => {
  const d = (id: number): DisplayInfo => ({ id, bounds: { x: id * 100, y: 0, width: 100, height: 100 } });
  const all = [d(1), d(2), d(3)];

  it('all, primary and selected', () => {
    expect(selectDisplays(all, 2, { mode: 'all' }).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(selectDisplays(all, 2, { mode: 'primary' }).map((x) => x.id)).toEqual([2]);
    expect(selectDisplays(all, 2, { mode: 'selected', ids: [3, 1] }).map((x) => x.id)).toEqual([1, 3]);
  });

  it('builtin picks the internal screen, or the primary when there is none', () => {
    const withInternal = [d(1), { ...d(2), internal: true }, d(3)];
    expect(selectDisplays(withInternal, 1, { mode: 'builtin' }).map((x) => x.id)).toEqual([2]);
    expect(selectDisplays(all, 3, { mode: 'builtin' }).map((x) => x.id)).toEqual([3]);
  });

  it('falls back to the primary display when selected displays are gone', () => {
    expect(selectDisplays(all, 2, { mode: 'selected', ids: [9] }).map((x) => x.id)).toEqual([2]);
    expect(selectDisplays(all, 42, { mode: 'primary' }).map((x) => x.id)).toEqual([1]);
    expect(selectDisplays([], 1, { mode: 'all' })).toEqual([]);
  });
});
