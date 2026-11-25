import { describe, expect, it } from 'vitest';
import { BreakTimer, BREAK_NUDGE_TEXT, BREAK_NUDGE_SECONDS } from '../src/core/break';

describe('BreakTimer', () => {
  it('is off at 0 minutes', () => {
    const b = new BreakTimer(0);
    let fired = false;
    for (let t = 0; t < 3600; t += 1) {
      if (b.update(t, true)) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('fires once after the chosen minutes of continuous presence', () => {
    const b = new BreakTimer(1); // one minute for the test
    let fires = 0;
    for (let t = 0; t < 240; t += 0.5) {
      if (b.update(t, true)) fires++;
    }
    expect(fires).toBe(1);
  });

  it('does not fire before the time is up', () => {
    const b = new BreakTimer(1);
    let fired = false;
    for (let t = 0; t < 59; t += 0.5) {
      if (b.update(t, true)) fired = true;
    }
    expect(fired).toBe(false);
  });

  it('a short absence (under 20 s) does not reset the stretch', () => {
    const b = new BreakTimer(1);
    let fireAt: number | null = null;
    let t = 0;
    while (t < 120) {
      const briefGap = t >= 30 && t < 31; // 1 s gap, under the 20 s reset
      if (b.update(t, !briefGap) && fireAt === null) fireAt = t;
      t += 0.5;
    }
    // The stretch survived the gap: the nudge came at ~60 s, not ~91 s.
    expect(fireAt).not.toBeNull();
    expect(fireAt!).toBeGreaterThanOrEqual(59);
    expect(fireAt!).toBeLessThanOrEqual(62);
  });

  it('a longer absence (20 s or more) resets the stretch', () => {
    const b = new BreakTimer(1);
    let t = 0;
    while (t < 50) {
      b.update(t, true);
      t += 0.5;
    }
    while (t < 75) {
      b.update(t, false); // 25 s away: a real break
      t += 0.5;
    }
    let fireAt: number | null = null;
    while (t < 75 + 65) {
      if (b.update(t, true) && fireAt === null) fireAt = t;
      t += 0.5;
    }
    // The new stretch started at the return (75): the nudge comes at ~135 s.
    expect(fireAt).not.toBeNull();
    expect(fireAt!).toBeGreaterThanOrEqual(75 + 59);
    expect(fireAt!).toBeLessThanOrEqual(75 + 62);
  });
});

describe('break nudge in the animator', () => {
  it('a due nudge shows the stretch message, points the hands and glances', async () => {
    const { EyeAnimator, defaultSettings, mergeSettings } = await import('../src/core');
    const { awayFace } = await import('./helpers');
    const s = mergeSettings(defaultSettings(), { breakReminderMinutes: 1, showHands: true });
    const a = new EyeAnimator(s, 21);
    // Person present (looking away, so no mood interference) for 61 s.
    let sawNudge = false;
    let sawPoint = false;
    let t = 0;
    while (t < 75) {
      if (Math.round(t * 60) % 3 === 0) a.ingest([awayFace()], t);
      const pose = a.update(t);
      if (pose.inspiration?.text === BREAK_NUDGE_TEXT) {
        sawNudge = true;
        if (pose.hands.gesture === 'point') sawPoint = true;
      }
      t += 1 / 60;
    }
    expect(sawNudge).toBe(true);
    expect(sawPoint).toBe(true);
  });

  it('the nudge lasts about six seconds', async () => {
    const { EyeAnimator, defaultSettings, mergeSettings } = await import('../src/core');
    const { awayFace } = await import('./helpers');
    const s = mergeSettings(defaultSettings(), { breakReminderMinutes: 1, showHands: true });
    const a = new EyeAnimator(s, 22);
    let first: number | null = null;
    let last: number | null = null;
    let t = 0;
    while (t < 75) {
      if (Math.round(t * 60) % 3 === 0) a.ingest([awayFace()], t);
      const pose = a.update(t);
      if (pose.inspiration?.text === BREAK_NUDGE_TEXT) {
        if (first === null) first = t;
        last = t;
      }
      t += 1 / 60;
    }
    expect(first).not.toBeNull();
    expect(last! - first!).toBeGreaterThan(BREAK_NUDGE_SECONDS - 1);
    expect(last! - first!).toBeLessThan(BREAK_NUDGE_SECONDS + 1);
  });
});
