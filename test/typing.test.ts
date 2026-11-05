import { describe, expect, it } from 'vitest';
import { ActivityClock, IdleMonitor } from '../src/core';

/**
 * Real macOS behavior: `getSystemIdleTime()` returns whole seconds since the last input event of any kind.
 * While you type, it stays at 0. These tests copy that, sample at 10 Hz like the app, and check that the
 * eyes never open while someone types or uses the mouse.
 */
interface Sim {
  clock: ActivityClock;
  monitor: IdleMonitor;
  shows: number[];
  maxIdle: number;
}

function sim(timeout = 15): Sim {
  return { clock: new ActivityClock(0), monitor: new IdleMonitor(timeout), shows: [], maxIdle: 0 };
}

/** Runs from `from` to `to`. `lastEvent(t)` = time of the last real input event; `pointer(t)` = pointer position. */
function run(s: Sim, from: number, to: number, lastEvent: (t: number) => number, pointer: (t: number) => { x: number; y: number }) {
  for (let t = from; t < to - 1e-9; t += 0.1) {
    const systemIdle = Math.floor(Math.max(0, t - lastEvent(t)));
    const idle = s.clock.sample(t, systemIdle, pointer(t));
    s.maxIdle = Math.max(s.maxIdle, idle);
    const e = s.monitor.update({ idleSeconds: idle, now: t, pointerMoved: s.clock.pointerActive(), pointerInEyes: false });
    if (e === 'show') s.shows.push(t);
  }
}

const still = () => ({ x: 500, y: 500 });

describe('the eyes never open while you use the computer', () => {
  it('typing continuously for 2 minutes (system idle stays 0)', () => {
    const s = sim();
    // A key every 0.2 s for 120 s.
    run(s, 0, 120, (t) => Math.floor(t * 5) / 5, still);
    expect(s.shows).toEqual([]);
    expect(s.maxIdle).toBeLessThan(2);
  });

  it('typing with short pauses (thinking) of up to 8 s', () => {
    const s = sim();
    // Bursts of typing, then 8 s pauses.
    const last = (t: number): number => {
      const cycle = t % 12;
      return cycle < 4 ? Math.floor(t * 5) / 5 : t - (cycle - 4);
    };
    run(s, 0, 180, last, still);
    expect(s.shows).toEqual([]);
  });

  it('typing while the hand nudges the mouse a few pixels', () => {
    const s = sim();
    // A 1-3 px wobble every second (hand resting on the mouse), keys every 0.2 s.
    run(s, 0, 120, (t) => Math.floor(t * 5) / 5, (t) => ({ x: 500 + (Math.floor(t) % 3), y: 500 }));
    expect(s.shows).toEqual([]);
  });

  it('scrolling or clicking only (no pointer movement), every 2 s', () => {
    const s = sim();
    run(s, 0, 90, (t) => Math.floor(t / 2) * 2, still);
    expect(s.shows).toEqual([]);
  });

  it('moving the mouse around', () => {
    const s = sim();
    run(s, 0, 60, (t) => t, (t) => ({ x: 500 + Math.round(Math.sin(t) * 200), y: 400 }));
    expect(s.shows).toEqual([]);
  });
});

describe('the eyes still open when you stop', () => {
  it('after typing stops, they open at the timeout (15 s), not earlier', () => {
    const s = sim();
    run(s, 0, 30, (t) => Math.min(Math.floor(t * 5) / 5, 10), still);
    expect(s.shows.length).toBe(1);
    expect(s.shows[0]!).toBeGreaterThanOrEqual(25);
    expect(s.shows[0]!).toBeLessThan(26.5);
  });

  it('a jittery mouse alone (no typing) does not keep them away', () => {
    const s = sim();
    // Nothing for 40 s except a 1 px wobble every 3 s that resets the system idle time.
    const wobbleAt = (t: number): number => Math.floor(t / 3) * 3;
    run(s, 0, 40, (t) => (t < 1 ? 0 : wobbleAt(t)), (t) => ({ x: 500 + (Math.floor(t / 3) % 2), y: 500 }));
    expect(s.shows.length).toBe(1);
    expect(s.shows[0]!).toBeLessThan(17);
  });
});

/** macOS: the idle helper gives separate counters. `ev(t)` returns the last time of each kind of event. */
function runExact(
  s: Sim,
  from: number,
  to: number,
  ev: (t: number) => { key: number; click: number; scroll: number; move: number },
  pointer: (t: number) => { x: number; y: number },
) {
  for (let t = from; t < to - 1e-9; t += 0.1) {
    const e = ev(t);
    const last = Math.max(e.key, e.click, e.scroll, e.move);
    const kinds = { key: t - e.key, click: t - e.click, scroll: t - e.scroll, move: t - e.move };
    const idle = s.clock.sample(t, Math.floor(t - last), pointer(t), kinds);
    s.maxIdle = Math.max(s.maxIdle, idle);
    const r = s.monitor.update({ idleSeconds: idle, now: t, pointerMoved: s.clock.pointerActive(), pointerInEyes: false });
    if (r === 'show') s.shows.push(t);
  }
}

describe('macOS exact counters', () => {
  const never = -1e9;
  it('typing continuously while the mouse wobbles every second: the eyes stay away', () => {
    const s = sim();
    runExact(
      s,
      0,
      120,
      (t) => ({ key: Math.floor(t * 5) / 5, click: never, scroll: never, move: Math.floor(t) }),
      (t) => ({ x: 500 + (Math.floor(t) % 2), y: 500 }),
    );
    expect(s.shows).toEqual([]);
    expect(s.maxIdle).toBeLessThan(0.5);
  });

  it('only a wobbling mouse: the eyes open at the timeout', () => {
    const s = sim();
    runExact(s, 0, 30, (t) => ({ key: never, click: never, scroll: never, move: Math.floor(t) }), (t) => ({ x: 500 + (Math.floor(t) % 2), y: 500 }));
    expect(s.shows.length).toBe(1);
    expect(s.shows[0]!).toBeLessThan(15.5);
  });

  it('scrolling only, or clicking only, keeps them away', () => {
    const scroll = sim();
    runExact(scroll, 0, 60, (t) => ({ key: never, click: never, scroll: Math.floor(t / 3) * 3, move: never }), still);
    expect(scroll.shows).toEqual([]);
    const click = sim();
    runExact(click, 0, 60, (t) => ({ key: never, click: Math.floor(t / 5) * 5, scroll: never, move: never }), still);
    expect(click.shows).toEqual([]);
  });

  it('after typing stops: they open 15 s later', () => {
    const s = sim();
    runExact(s, 0, 40, (t) => ({ key: Math.min(Math.floor(t * 5) / 5, 10), click: never, scroll: never, move: never }), still);
    expect(s.shows.length).toBe(1);
    expect(s.shows[0]!).toBeGreaterThanOrEqual(25);
    expect(s.shows[0]!).toBeLessThan(25.5);
  });

  it('parses the helper output', async () => {
    const { parseInputKinds } = await import('../src/core');
    expect(parseInputKinds('0.15 2.83 2.46 2.94\n')).toEqual({ key: 0.15, click: 2.83, scroll: 2.46, move: 2.94 });
    expect(parseInputKinds('garbage')).toBeNull();
    expect(parseInputKinds('1 2 3')).toBeNull();
    expect(parseInputKinds('1 2 -3 4')).toBeNull();
  });
});
