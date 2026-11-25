import { describe, expect, it } from 'vitest';
import { CursorGlancer } from '../src/core/cursor';

describe('CursorGlancer', () => {
  it('glances toward the cursor when nobody is there', () => {
    const g = new CursorGlancer(1);
    // A cursor event to the right, nobody present: within a moment the eyes glance that way.
    g.noteCursor(0.9, 0.5, 0);
    let glance = null;
    for (let t = 0; t < 6; t += 1 / 60) {
      glance = g.update(t, false);
      if (glance) break;
    }
    expect(glance).not.toBeNull();
    expect(glance!.x).toBeGreaterThan(0.3);
  });

  it('never glances while a person is present', () => {
    const g = new CursorGlancer(2);
    g.noteCursor(0.9, 0.5, 0);
    let glance = null;
    for (let t = 0; t < 10; t += 1 / 60) {
      glance = g.update(t, true);
      if (glance) break;
    }
    expect(glance).toBeNull();
  });

  it('glances are brief and spaced out', () => {
    const g = new CursorGlancer(3);
    const spans: Array<[number, number]> = [];
    let start: number | null = null;
    let last: number | null = null;
    for (let t = 0; t < 20; t += 1 / 60) {
      // A live pointer keeps moving (so its position stays fresh, like at a real desk).
      if (Math.round(t * 60) % 30 === 0) g.noteCursor(0.2 + 0.05 * Math.sin(t), 0.8, t);
      const glance = g.update(t, false);
      if (glance && start === null) start = t;
      if (glance) last = t;
      if (!glance && start !== null) {
        spans.push([start, last!]);
        start = null;
      }
    }
    if (start !== null) spans.push([start, last!]);
    expect(spans.length).toBeGreaterThanOrEqual(3);
    for (const [from, to] of spans) {
      expect(to - from).toBeLessThan(1.4); // each glance is short
    }
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]![0] - spans[i - 1]![1]).toBeGreaterThanOrEqual(1.5); // gaps between glances
    }
  });

  it('the direction follows the cursor', () => {
    const g = new CursorGlancer(4);
    g.noteCursor(0.1, 0.5, 0); // far left
    let left = null as { x: number } | null;
    for (let t = 0; t < 6; t += 1 / 60) {
      left = g.update(t, false);
      if (left) break;
    }
    expect(left).not.toBeNull();
    expect(left!.x).toBeLessThan(-0.3);

    const h = new CursorGlancer(5);
    h.noteCursor(0.5, 0.15, 0); // near the top (screen y 0.15 → up)
    let up = null as { x: number; y: number } | null;
    for (let t = 0; t < 6; t += 1 / 60) {
      up = h.update(t, false);
      if (up) break;
    }
    expect(up).not.toBeNull();
    expect(up!.y).toBeGreaterThan(0.2);
  });

  it('a stale cursor event (older than 1.5 s) does not cause a glance', () => {
    const g = new CursorGlancer(6);
    g.noteCursor(0.9, 0.5, 0);
    let glance = null;
    for (let t = 2; t < 8; t += 1 / 60) {
      glance = g.update(t, false);
      if (glance) break;
    }
    expect(glance).toBeNull();
  });

  it('the animator glances toward the cursor in its gaze (nobody present)', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    // Same seed, two runs: with and without cursor sightings. The cursor run must look
    // further right than idle wandering alone ever does.
    const control = new EyeAnimator(defaultSettings(), 12);
    const watching = new EyeAnimator(defaultSettings(), 12);
    let controlMax = 0;
    let watchingMax = 0;
    for (let t = 0; t < 2.4; t += 1 / 60) {
      // Before bored (2.5 s), so the wandering stays in the curious range.
      if (Math.round(t * 60) % 30 === 0) watching.cursor.noteCursor(0.95, 0.5, t);
      controlMax = Math.max(controlMax, control.update(t).gaze.x);
      watchingMax = Math.max(watchingMax, watching.update(t).gaze.x);
    }
    expect(watchingMax).toBeGreaterThan(controlMax + 0.1);
    expect(watchingMax).toBeGreaterThan(0.8); // clearly toward the pointer, not a wander
  });

  it('losing the person does not fire a glance at once', () => {
    const g = new CursorGlancer(7);
    // Person present for a while (arms a wait), then gone; a fresh cursor sighting exists.
    g.noteCursor(0.9, 0.5, 0);
    for (let t = 0; t < 10; t += 1 / 60) g.update(t, true);
    g.noteCursor(0.9, 0.5, 10);
    // The first frames after the loss must not glance (the wait was armed).
    for (let t = 10; t < 10.3; t += 1 / 60) {
      expect(g.update(t, false)).toBeNull();
    }
  });

  it('the cursor resuming after a stale spell waits before glancing again', () => {
    const g = new CursorGlancer(8);
    g.noteCursor(0.9, 0.5, 0);
    // Fresh until 1.5 s, then stale until 8 s, then fresh again from 8 s.
    for (let t = 0; t < 8; t += 1 / 60) g.update(t, false);
    g.noteCursor(0.9, 0.5, 8);
    let glanced = false;
    for (let t = 8; t < 8.3; t += 1 / 60) {
      if (g.update(t, false)) glanced = true;
    }
    expect(glanced).toBe(false); // the resume waits, it does not burst
  });
});
