import { describe, expect, it } from 'vitest';
import {
  BlinkScheduler,
  defaultSettings,
  EyeAnimator,
  IdleMonitor,
  mergeSettings,
  normalizeSettings,
  staticPose,
  type FaceObservation,
} from '../src/core';
import { eyeBounds, eyeLayout } from '../src/renderer/draw';
import { awayFace, lookingFace } from './helpers';

function countBlinks(b: BlinkScheduler, seconds: number): number {
  let blinks = 0;
  let wasClosed = false;
  for (let t = 0; t < seconds; t += 1 / 240) {
    const c = b.closure(t);
    if (c > 0.9 && !wasClosed) blinks++;
    wasClosed = c > 0.9;
  }
  return blinks;
}

/** Longest time (s) a blink keeps the lid more than half closed. */
function blinkLength(b: BlinkScheduler): number {
  b.enabled = false;
  b.trigger(0);
  let closed = 0;
  for (let t = 0; t < 2; t += 1 / 1000) if (b.closure(t) > 0.5) closed += 1 / 1000;
  return closed;
}

describe('blink settings', () => {
  it('rate changes how often the eyes blink', () => {
    const normal = new BlinkScheduler(5, 0);
    const often = new BlinkScheduler(5, 0);
    often.rate = 2.5;
    const rarely = new BlinkScheduler(5, 0);
    rarely.rate = 0.4;
    const n = countBlinks(normal, 120);
    expect(countBlinks(often, 120)).toBeGreaterThan(n * 1.8);
    expect(countBlinks(rarely, 120)).toBeLessThan(n * 0.6);
  });

  it('rate 0 means no automatic blinks', () => {
    const b = new BlinkScheduler(5, 0);
    b.rate = 0;
    expect(countBlinks(b, 60)).toBe(0);
  });

  it('speed changes how long one blink takes', () => {
    const quick = new BlinkScheduler(1, 0);
    quick.speed = 2;
    const slow = new BlinkScheduler(1, 0);
    slow.speed = 0.5;
    expect(blinkLength(slow)).toBeGreaterThan(blinkLength(quick) * 3);
  });

  it('the animator passes the settings on', () => {
    const s = mergeSettings(defaultSettings(), { blink: { rate: 0 } });
    const a = new EyeAnimator(s, 3);
    let maxLid = 0;
    // Curious mood, nobody there for < 8 s: lid normally 0.12, only blinks close it.
    for (let t = 0; t < 7; t += 1 / 60) maxLid = Math.max(maxLid, t > 1.5 ? a.update(t).upperLid : (a.update(t), 0));
    expect(maxLid).toBeLessThan(0.5);
  });
});

describe('eye position', () => {
  const W = 1728;
  const H = 1117;
  const pose = staticPose('curious');

  it('every position keeps the eyes on screen', () => {
    for (const position of ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      for (const drift of [-1, 0, 1]) {
        for (const size of [0.2, 0.35, 0.6, 1, 1.7, 2.5]) {
          const b = eyeBounds(eyeLayout(W, H, { ...pose, drift: { x: drift, y: drift } }, size, undefined, position));
          expect(b.x).toBeGreaterThanOrEqual(-1);
          expect(b.y).toBeGreaterThanOrEqual(-1);
          expect(b.x + b.width).toBeLessThanOrEqual(W + 1);
          expect(b.y + b.height).toBeLessThanOrEqual(H + 1);
        }
      }
    }
  });

  it('corners are in the corners', () => {
    const at = (position: Parameters<typeof eyeLayout>[5]) => eyeLayout(W, H, pose, 1, undefined, position);
    expect(at('top-left').cx).toBeLessThan(W / 3);
    expect(at('top-left').cy).toBeLessThan(H / 3);
    expect(at('top-right').cx).toBeGreaterThan((W * 2) / 3);
    // The eyes sit a bit higher than the bottom third, because the mouth is under them.
    const bottom = eyeBounds(at('bottom-left'));
    expect(bottom.y + bottom.height).toBeGreaterThan(H * 0.85);
    expect(at('bottom-left').cy).toBeGreaterThan(H * 0.6);
    expect(at('bottom-right').cx).toBeGreaterThan((W * 2) / 3);
    expect(at('center').cx).toBeCloseTo(W / 2, 0);
  });
});

describe('mouse rules', () => {
  const shown = (): IdleMonitor => {
    const m = new IdleMonitor(30);
    m.update({ idleSeconds: 30, now: 30 });
    return m;
  };

  it("'any' closes on any movement", () => {
    const m = shown();
    expect(m.update({ idleSeconds: 0, now: 30.1, pointerMoved: true, pointerInEyes: false, mouseRule: 'any' })).toBe('hide');
    expect(m.lastHideReason).toBe('pointer-moved');
  });

  it("'never' ignores movement, even onto the eyes", () => {
    const m = shown();
    for (let t = 30.1; t < 32; t += 0.1) {
      expect(m.update({ idleSeconds: 0, now: t, pointerMoved: true, pointerInEyes: true, mouseRule: 'never' })).toBeNull();
    }
    // A key press still closes them.
    expect(m.update({ idleSeconds: 0, now: 34, mouseRule: 'never' })).toBe('hide');
    expect(m.lastHideReason).toBe('input');
  });

  it("'onto-eyes' is the default", () => {
    expect(defaultSettings().mouseRule).toBe('onto-eyes');
    const m = shown();
    expect(m.update({ idleSeconds: 0, now: 30.1, pointerMoved: true, pointerInEyes: false })).toBeNull();
    expect(m.update({ idleSeconds: 0, now: 30.2, pointerMoved: true, pointerInEyes: true })).toBe('hide');
  });
});

describe('look to close', () => {
  function simulate(a: EyeAnimator, faces: FaceObservation[], from: number, seconds: number): number {
    let t = from;
    let frame = 0;
    while (t < from + seconds) {
      if (frame++ % 3 === 0) a.ingest(faces, t);
      a.update(t);
      t += 1 / 60;
    }
    return t;
  }

  it('is off by default', () => {
    const a = new EyeAnimator(defaultSettings(), 1);
    simulate(a, [lookingFace()], 0, 8);
    expect(a.wantsToClose).toBe(false);
    expect(a.pose.closeProgress).toBeLessThan(0.01);
  });

  it('holding eye contact fills the ring, winks, then asks to close', () => {
    const s = mergeSettings(defaultSettings(), { lookToClose: true, lookToCloseSeconds: 2 });
    const a = new EyeAnimator(s, 1);
    let t = simulate(a, [lookingFace()], 0, 1.6);
    expect(a.pose.closeProgress).toBeGreaterThan(0.2);
    expect(a.wantsToClose).toBe(false);
    let maxWink = 0;
    while (t < 5 && !a.wantsToClose) {
      a.ingest([lookingFace()], t);
      maxWink = Math.max(maxWink, a.update(t).wink);
      t += 1 / 60;
    }
    expect(a.wantsToClose).toBe(true);
    expect(maxWink).toBeGreaterThan(0.6);
  });

  it('looking away resets the timer', () => {
    const s = mergeSettings(defaultSettings(), { lookToClose: true, lookToCloseSeconds: 2 });
    const a = new EyeAnimator(s, 1);
    let t = 0;
    for (let i = 0; i < 4; i++) {
      t = simulate(a, [lookingFace()], t, 1.5);
      t = simulate(a, [awayFace()], t, 1.5);
    }
    expect(a.wantsToClose).toBe(false);
  });

  it('can be suspended (calibration)', () => {
    const s = mergeSettings(defaultSettings(), { lookToClose: true, lookToCloseSeconds: 1 });
    const a = new EyeAnimator(s, 1);
    a.lookToCloseSuspended = true;
    simulate(a, [lookingFace()], 0, 5);
    expect(a.wantsToClose).toBe(false);
  });
});

describe('new settings validation', () => {
  it('defaults and bad values', () => {
    const d = defaultSettings();
    expect(d.position).toBe('center');
    expect(d.blink).toEqual({ rate: 1, speed: 1 });
    expect(d.lookToClose).toBe(false);
    const s = normalizeSettings({ position: 'middle', mouseRule: 'sometimes', blink: { rate: 9, speed: 0 }, lookToCloseSeconds: 0 });
    expect(s.position).toBe('center');
    expect(s.mouseRule).toBe('onto-eyes');
    expect(s.blink).toEqual({ rate: 3, speed: 0.3 });
    expect(s.lookToCloseSeconds).toBe(0.5);
  });

  it('old settings files without the new keys keep their values', () => {
    const s = normalizeSettings({ eyeSize: 1.7, screens: { mode: 'primary' } });
    expect(s.eyeSize).toBe(1.7);
    expect(s.screens).toEqual({ mode: 'primary' });
    expect(s.position).toBe('center');
  });

  it('merges one blink value', () => {
    expect(mergeSettings(defaultSettings(), { blink: { speed: 2 } }).blink).toEqual({ rate: 1, speed: 2 });
  });
});
