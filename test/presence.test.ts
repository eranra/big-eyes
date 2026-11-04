import { describe, expect, it } from 'vitest';
import { defaultSettings, isWatching, makeFace, normalizeSettings, PresenceCheck } from '../src/core';
import { parsePmsetAssertions } from '../src/main/system';

const reader = makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 5, pitch: 25, gaze: { x: 0, y: -0.5 } });
const turnedAway = makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 70, pitch: 0 });

describe('isWatching', () => {
  it('a person reading the screen counts, even looking down at the text', () => {
    expect(isWatching(reader)).toBe(true);
  });

  it('a person turned away, a tiny far face, or a side camera does not count', () => {
    expect(isWatching(turnedAway)).toBe(false);
    expect(isWatching({ ...reader, size: 0.02 })).toBe(false);
    expect(isWatching({ ...reader, camera: 1 })).toBe(false);
  });
});

describe('PresenceCheck', () => {
  it('someone watching: wait, then check again later', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    expect(p.due(30)).toBe(true);
    p.start(30);
    expect(p.result(30.5)).toBeNull();
    p.report([reader], 30.6);
    expect(p.result(31)).toBe('watched');
    expect(p.due(40)).toBe(false);
    expect(p.due(46)).toBe(true);
  });

  it('nobody watching: show after the check time', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    p.start(30);
    p.report([turnedAway], 30.2);
    expect(p.result(32)).toBeNull();
    expect(p.result(33.3)).toBe('nobody');
    expect(p.phase).toBe('idle');
  });

  it('a slow camera start does not count as "nobody" (the check waits for the first frame)', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    p.start(30);
    // The camera and face model need 5 s to start: no frames yet, still checking.
    expect(p.result(35)).toBeNull();
    p.report([], 35.5);
    expect(p.result(36)).toBeNull();
    p.report([reader], 36.2);
    expect(p.result(36.3)).toBe('watched');
  });

  it('a camera that never sends a frame gives up after the start timeout', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    p.start(30);
    expect(p.result(44)).toBeNull();
    expect(p.result(45)).toBe('nobody');
  });

  it('reports outside a check are ignored; reset starts over', () => {
    const p = new PresenceCheck();
    p.report([reader], 0);
    p.start(0);
    p.report([], 0.5);
    expect(p.result(10)).toBe('nobody');
    p.start(20);
    p.report([reader], 20.05);
    p.result(20.1);
    p.reset();
    expect(p.due(20.2)).toBe(true);
  });

  it('a camera failure never blocks the eyes', () => {
    const p = new PresenceCheck();
    p.start(0);
    p.fail();
    expect(p.phase).toBe('idle');
    expect(p.result(1)).toBeNull();
  });
});

describe('camera warm-up', () => {
  it('dark first frames do not end the check as "nobody"', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 1, recheckSeconds: 15 });
    p.start(0);
    p.report([], 0.5); // first frame, still dark
    expect(p.result(3.6)).toBeNull(); // 3.1 s of frames is not enough with a 1 s warm-up
    p.report([reader], 3.8); // exposure settled, the reader is found
    expect(p.result(3.9)).toBe('watched');
  });

  it('nobody after warm-up plus the check time', () => {
    const p = new PresenceCheck();
    p.start(0);
    p.report([], 0.5);
    expect(p.result(4.4)).toBeNull();
    expect(p.result(4.6)).toBe('nobody');
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
