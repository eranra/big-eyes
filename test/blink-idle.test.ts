import { describe, expect, it } from 'vitest';
import { BlinkScheduler, IdleMonitor, pointInRects } from '../src/core';

describe('BlinkScheduler', () => {
  it('blinks regularly and closes fully', () => {
    const b = new BlinkScheduler(3, 0);
    let blinks = 0;
    let wasClosed = false;
    let maxClosure = 0;
    for (let t = 0; t < 60; t += 1 / 120) {
      const c = b.closure(t);
      maxClosure = Math.max(maxClosure, c);
      if (c > 0.9 && !wasClosed) blinks++;
      wasClosed = c > 0.9;
    }
    expect(maxClosure).toBeGreaterThan(0.99);
    expect(blinks).toBeGreaterThanOrEqual(10);
    expect(blinks).toBeLessThanOrEqual(40);
  });

  it('disabled means no blinks', () => {
    const b = new BlinkScheduler(3, 0);
    b.enabled = false;
    for (let t = 0; t < 20; t += 0.05) expect(b.closure(t)).toBe(0);
  });

  it('a triggered blink runs and ends', () => {
    const b = new BlinkScheduler(3, 0);
    b.enabled = false;
    b.trigger(10);
    expect(b.closure(10.09)).toBe(1);
    expect(b.closure(10.5)).toBe(0);
  });
});

describe('IdleMonitor', () => {
  it('shows after the timeout and hides on a key press', () => {
    const m = new IdleMonitor(30);
    expect(m.update({ idleSeconds: 20, now: 20 })).toBeNull();
    expect(m.update({ idleSeconds: 30, now: 30 })).toBe('show');
    expect(m.update({ idleSeconds: 45, now: 45 })).toBeNull();
    // Idle time resets, but the mouse did not move: keyboard or click.
    expect(m.update({ idleSeconds: 0, now: 46 })).toBe('hide');
    expect(m.lastHideReason).toBe('input');
  });

  it('whole-second rounding does not hide by mistake', () => {
    const m = new IdleMonitor(10);
    expect(m.update({ idleSeconds: 10, now: 10.9 })).toBe('show');
    expect(m.update({ idleSeconds: 10, now: 11.8 })).toBeNull();
    expect(m.update({ idleSeconds: 11, now: 12.7 })).toBeNull();
  });

  it('moving the mouse outside the eyes keeps them', () => {
    const m = new IdleMonitor(10);
    m.update({ idleSeconds: 10, now: 10 });
    for (let t = 10.1; t < 13; t += 0.1) {
      expect(m.update({ idleSeconds: 0, now: t, pointerMoved: true, pointerInEyes: false })).toBeNull();
    }
    // The mouse stops. The idle time grows again from 0; nothing hides.
    expect(m.update({ idleSeconds: 0, now: 13.5 })).toBeNull();
    expect(m.update({ idleSeconds: 2, now: 15.1 })).toBeNull();
    expect(m.isShowing).toBe(true);
  });

  it('a key press after mouse movement still hides', () => {
    const m = new IdleMonitor(10);
    m.update({ idleSeconds: 10, now: 10 });
    m.update({ idleSeconds: 0, now: 11, pointerMoved: true });
    expect(m.update({ idleSeconds: 3, now: 14 })).toBeNull();
    expect(m.update({ idleSeconds: 0, now: 14.5 })).toBe('hide');
  });

  it('moving the mouse into the eyes hides them', () => {
    const m = new IdleMonitor(10);
    m.update({ idleSeconds: 10, now: 10 });
    expect(m.update({ idleSeconds: 0, now: 10.1, pointerMoved: true, pointerInEyes: true })).toBe('hide');
    expect(m.lastHideReason).toBe('pointer-in-eyes');
  });

  it('a pointer resting inside the eyes does not hide them', () => {
    const m = new IdleMonitor(10);
    m.update({ idleSeconds: 10, now: 10 });
    expect(m.update({ idleSeconds: 11, now: 11, pointerMoved: false, pointerInEyes: true })).toBeNull();
  });

  it('does not show while blocked, hides when blocked', () => {
    const m = new IdleMonitor(10);
    expect(m.update({ idleSeconds: 20, now: 20, blocked: true })).toBeNull();
    expect(m.update({ idleSeconds: 21, now: 21 })).toBe('show');
    expect(m.update({ idleSeconds: 22, now: 22, blocked: true })).toBe('hide');
  });

  it('after a dismissal waits for a new idle period', () => {
    const m = new IdleMonitor(10);
    m.update({ idleSeconds: 15, now: 15 });
    expect(m.forceHide()).toBe('hide');
    expect(m.update({ idleSeconds: 16, now: 16 })).toBeNull();
    expect(m.update({ idleSeconds: 0, now: 17 })).toBeNull();
    expect(m.update({ idleSeconds: 10, now: 27 })).toBe('show');
  });

  it('forced show detects input that follows', () => {
    const m = new IdleMonitor(60);
    expect(m.forceShow(100, 0)).toBe('show');
    expect(m.forceShow(100, 0)).toBeNull();
    expect(m.update({ idleSeconds: 3, now: 103 })).toBeNull();
    expect(m.update({ idleSeconds: 0, now: 106 })).toBe('hide');
  });
});

describe('pointInRects', () => {
  const rects = [{ x: 100, y: 100, width: 200, height: 100 }];
  it('inside, outside and margin', () => {
    expect(pointInRects({ x: 150, y: 150 }, rects)).toBe(true);
    expect(pointInRects({ x: 90, y: 150 }, rects)).toBe(false);
    expect(pointInRects({ x: 90, y: 150 }, rects, 20)).toBe(true);
    expect(pointInRects({ x: 0, y: 0 }, [])).toBe(false);
  });
});
