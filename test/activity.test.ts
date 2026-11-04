import { describe, expect, it } from 'vitest';
import { ActivityClock } from '../src/core';

/** Feeds samples every 0.1 s. `step(t)` returns [systemIdle, pointer]. */
function run(clock: ActivityClock, from: number, to: number, step: (t: number) => [number, { x: number; y: number }]): number {
  let idle = 0;
  for (let t = from; t < to - 1e-9; t += 0.1) {
    const [sys, p] = step(t);
    idle = clock.sample(t, sys, p);
  }
  return idle;
}

describe('ActivityClock', () => {
  it('nothing happens: idle time grows', () => {
    const c = new ActivityClock(0);
    const idle = run(c, 0, 30, (t) => [Math.floor(t), { x: 500, y: 500 }]);
    expect(idle).toBeGreaterThan(29);
  });

  it('a jittery mouse (1-2 px moves that reset the system idle time) does not count as input', () => {
    const c = new ActivityClock(0);
    // Every 3 s the mouse moves by 1 px and the system idle time drops to 0.
    const idle = run(c, 0, 40, (t) => {
      const phase = t % 3;
      return [Math.floor(phase), { x: 500 + (Math.floor(t / 3) % 2), y: 500 }];
    });
    expect(idle).toBeGreaterThan(35);
  });

  it('real mouse use counts', () => {
    const c = new ActivityClock(0);
    run(c, 0, 20, (t) => [Math.floor(t), { x: 500, y: 500 }]);
    // The user moves the mouse 60 px over half a second.
    const idle = run(c, 20, 20.6, (t) => [0, { x: 500 + Math.round((t - 20) * 100), y: 500 }]);
    expect(idle).toBeLessThan(0.5);
  });

  it('a key press (system idle resets, pointer still) counts', () => {
    const c = new ActivityClock(0);
    run(c, 0, 20, (t) => [Math.floor(t), { x: 500, y: 500 }]);
    const idle = run(c, 20, 20.3, () => [0, { x: 500, y: 500 }]);
    expect(idle).toBeLessThan(0.5);
  });

  it('a key press right after a tiny jitter is not lost for long', () => {
    const c = new ActivityClock(0);
    run(c, 0, 10, (t) => [Math.floor(t), { x: 500, y: 500 }]);
    // Jitter at t=10, then typing from t=12.5 (system idle stays 0 while typing).
    run(c, 10, 10.2, () => [0, { x: 501, y: 500 }]);
    const idle = run(c, 10.2, 15, (t) => [t < 12.5 ? Math.floor(t - 10) : 0, { x: 501, y: 500 }]);
    expect(idle).toBeLessThan(3);
  });

  it('trusts a large system idle time from before the app started', () => {
    const c = new ActivityClock(0);
    expect(c.sample(0, 120, { x: 1, y: 1 })).toBe(120);
  });
});

describe('jitter while the eyes are showing', () => {
  it('jitter does not close the eyes; a key press does', async () => {
    const { IdleMonitor } = await import('../src/core');
    const c = new ActivityClock(0);
    const m = new IdleMonitor(10);
    let shownAt = -1;
    let hiddenAt = -1;
    // System idle time as macOS reports it: grows, and drops to 0 on every input event (jitter or key).
    let lastEvent = 0;
    let wobble = 0;
    for (let t = 0; t < 40; t += 0.1) {
      const jitter = t > 12 && t < 25 && Math.round(t * 10) % 30 === 0; // a 1 px wobble every 3 s
      const keyPress = t >= 30 && t < 30.2;
      if (jitter) wobble = 1 - wobble;
      if (jitter || keyPress) lastEvent = t;
      const sys = Math.floor(t - lastEvent);
      const idle = c.sample(t, sys, { x: 500 + wobble, y: 500 });
      const e = m.update({ idleSeconds: idle, now: t, pointerMoved: c.pointerActive(), pointerInEyes: false });
      if (e === 'show' && shownAt < 0) shownAt = t;
      if (e === 'hide' && hiddenAt < 0) hiddenAt = t;
    }
    expect(shownAt).toBeGreaterThanOrEqual(10);
    expect(shownAt).toBeLessThan(11);
    expect(hiddenAt).toBeGreaterThanOrEqual(30);
    expect(hiddenAt).toBeLessThan(31);
  });
});
