import { describe, expect, it } from 'vitest';
import {
  AttentionEstimator,
  defaultSettings,
  makeFace,
  mergeSettings,
  normalizeSettings,
  PresenceCheck,
  type FaceObservation,
} from '../src/core';
import { parsePmsetAssertions } from '../src/main/system';

// Values measured on a MacBook Pro with a calibrated user (reference yaw 2.2, pitch 12.5, gaze 0.15, 0.11).
const attention = mergeSettings(defaultSettings(), {
  attention: { reference: { yaw: 2.2, pitch: 12.5, gaze: { x: 0.15, y: 0.11 } } },
}).attention;
const atScreen = (): FaceObservation =>
  makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 1.3, pitch: 12.5, gaze: { x: 0.18, y: 0.12 } });
const atPhone = (): FaceObservation =>
  makeFace({ center: { x: 0.5, y: 0.6 }, size: 0.3, yaw: 23, pitch: 4, gaze: { x: -0.35, y: -0.46 } });

/** Feeds faces at 20 frames per second from `from` to `to`, returning the first result. */
function feed(p: PresenceCheck, faces: () => FaceObservation[], from: number, to: number): 'watched' | 'nobody' | null {
  for (let t = from; t < to; t += 0.05) {
    p.report(faces(), t);
    const r = p.result(t);
    if (r) return r;
  }
  return null;
}

const timing = { checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 1, recheckSeconds: 15 };

describe('PresenceCheck uses the eye contact process', () => {
  it('looking at the screen: the eyes wait, and check again later', () => {
    const p = new PresenceCheck(timing);
    p.start(30, attention);
    expect(feed(p, () => [atScreen()], 30.2, 36)).toBe('watched');
    expect(p.due(40)).toBe(false);
    expect(p.due(46.5)).toBe(true);
  });

  it('sitting there looking at a phone: the eyes appear', () => {
    const p = new PresenceCheck(timing);
    p.start(30, attention);
    expect(feed(p, () => [atPhone()], 30.2, 36)).toBe('nobody');
  });

  it('nobody in front of the camera: the eyes appear after warm-up plus the check time', () => {
    const p = new PresenceCheck(timing);
    p.start(30, attention);
    p.report([], 30.5);
    expect(p.result(34.4)).toBeNull();
    expect(p.result(34.6)).toBe('nobody');
  });

  it('a single glance at the screen is not enough (smoothed, like eye contact)', () => {
    const p = new PresenceCheck(timing);
    p.start(0, attention);
    let frame = 0;
    // One screen frame out of every ten, the rest at the phone.
    expect(feed(p, () => [frame++ % 10 === 0 ? atScreen() : atPhone()], 0.2, 6)).toBe('nobody');
  });

  it('a slow camera start does not count as "nobody"', () => {
    const p = new PresenceCheck(timing);
    p.start(30, attention);
    expect(p.result(35)).toBeNull(); // no frames yet
    expect(feed(p, () => [atScreen()], 35.5, 40)).toBe('watched');
  });

  it('a camera that never sends a frame gives up after the start timeout', () => {
    const p = new PresenceCheck(timing);
    p.start(30, attention);
    expect(p.result(44)).toBeNull();
    expect(p.result(45)).toBe('nobody');
  });

  it('a second, uncalibrated camera never counts as looking at the screen', () => {
    const p = new PresenceCheck(timing);
    p.start(0, attention, false, [], [
      { index: 0, label: 'MacBook Pro Camera', id: 'a' },
      { index: 1, label: 'HD Pro Webcam C920', id: 'b' },
    ]);
    expect(feed(p, () => [{ ...atScreen(), camera: 1 }], 0.2, 6)).toBe('nobody');
  });

  it('each check starts fresh; reset and camera failure never block the eyes', () => {
    const p = new PresenceCheck(timing);
    p.start(0, attention);
    expect(feed(p, () => [atScreen()], 0.2, 5)).toBe('watched');
    p.reset();
    expect(p.due(5.1)).toBe(true);
    p.start(5.1, attention);
    expect(feed(p, () => [atPhone()], 5.2, 11)).toBe('nobody');
    p.start(20, attention);
    p.fail();
    expect(p.phase).toBe('idle');
    expect(p.result(21)).toBeNull();
  });

  it('makes the same decision as the eyes themselves', () => {
    const e = new AttentionEstimator(attention);
    for (let t = 0; t < 2; t += 0.05) e.ingest([atPhone()], t);
    expect(e.state.isMakingEyeContact).toBe(false);
    for (let t = 2; t < 4; t += 0.05) e.ingest([atScreen()], t);
    expect(e.state.isMakingEyeContact).toBe(true);
  });
});

describe('new defaults', () => {
  it('wait while watched is on, screen saver pauses the eyes', () => {
    const d = defaultSettings();
    expect(d.waitWhileWatched).toBe(true);
    expect(d.screenSaver).toBe('pause');
    expect(normalizeSettings({ screenSaver: 'replace' }).screenSaver).toBe('replace');
    expect(normalizeSettings({ screenSaver: 'sometimes' }).screenSaver).toBe('pause');
    expect(normalizeSettings({ waitWhileWatched: false }).waitWhileWatched).toBe(false);
  });
});

describe('pmset with our own assertion', () => {
  const output = `Assertion status system-wide:
   PreventUserIdleDisplaySleep    1
Listed by owning process:
   pid 550(powerd): [0x01] 04:47:21 PreventUserIdleSystemSleep named: "Powerd - Prevent sleep while display is on"
   pid 4242(Big Eyes): [0x02] 00:01:00 PreventUserIdleDisplaySleep named: "Electron"
Kernel Assertions: 0x104=USB`;

  it('our own blocker does not count as "a video is playing"', () => {
    expect(parsePmsetAssertions(output, [4242])).toBe(false);
    expect(parsePmsetAssertions(output, [])).toBe(true);
  });

  it('another app that keeps the display on still counts', () => {
    const withVideo = output.replace('Kernel', '   pid 2761(Google Chrome): [0x03] 00:00:38 PreventUserIdleDisplaySleep named: "Video Wake Lock"\nKernel');
    expect(parsePmsetAssertions(withVideo, [4242])).toBe(true);
  });
});

describe('blur behind the eyes', () => {
  it('replace mode: no blur for the normal eyes, blur once the screen saver time is reached', async () => {
    const { blurActive } = await import('../src/core');
    const replace = { ...defaultSettings(), screenSaver: 'replace' as const };
    // The system screen saver (or display sleep) time is 60 minutes.
    expect(blurActive(replace, 30, 3600)).toBe(false);
    expect(blurActive(replace, 3599, 3600)).toBe(false);
    expect(blurActive(replace, 3600, 3600)).toBe(true);
  });

  it('pause mode never blurs; "always" blurs at once; "off" never blurs', async () => {
    const { blurActive } = await import('../src/core');
    const d = defaultSettings();
    expect(blurActive(d, 99999, 600)).toBe(false);
    expect(blurActive({ ...d, blur: 'always' }, 30, 3600)).toBe(true);
    expect(blurActive({ ...d, blur: 'off', screenSaver: 'replace' }, 99999, 600)).toBe(false);
  });

  it('screen saver time: own setting, else the system, else 10 minutes', async () => {
    const { screenSaverSeconds } = await import('../src/core');
    expect(screenSaverSeconds({ screenSaverMinutes: 15 }, 3600)).toBe(900);
    expect(screenSaverSeconds({ screenSaverMinutes: 0 }, 3600)).toBe(3600);
    expect(screenSaverSeconds({ screenSaverMinutes: 0 }, null)).toBe(600);
    expect(defaultSettings().screenSaverMinutes).toBe(0);
  });

  it('validates blur values', () => {
    expect(normalizeSettings({ blur: 'heavy' }).blur).toBe('screensaver');
    expect(normalizeSettings({ blurStrength: 5 }).blurStrength).toBe(1);
    expect(normalizeSettings({ blurStrength: 0 }).blurStrength).toBe(0.3);
    expect(normalizeSettings({ screenSaverMinutes: 7.6 }).screenSaverMinutes).toBe(8);
    expect(normalizeSettings({ screenSaverMinutes: -5 }).screenSaverMinutes).toBe(0);
  });
});
