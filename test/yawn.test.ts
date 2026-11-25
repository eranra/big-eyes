import { describe, expect, it } from 'vitest';
import { defaultSettings, EyeAnimator, mergeSettings, type FaceObservation } from '../src/core';
import { lookingFace } from './helpers';

/** Runs at 60 fps with camera frames at 20 fps, tracking the peak mouthOpen in a time window. */
function run(a: EyeAnimator, faces: FaceObservation[], from: number, seconds: number, window?: [number, number]): number {
  let t = from;
  let frame = 0;
  let peak = 0;
  while (t < from + seconds) {
    if (frame++ % 3 === 0) a.ingest(faces, t);
    const pose = a.update(t);
    if (!window || (t >= window[0] && t <= window[1])) peak = Math.max(peak, pose.mouthOpen);
    t += 1 / 60;
  }
  return peak;
}

describe('yawn before sleeping', () => {
  it('the eyes yawn as they fall asleep: the mouth opens wide, then settles into sleep', () => {
    const a = new EyeAnimator(defaultSettings(), 5);
    // Nobody for 12 s: the mood becomes sleeping at ~8 s (absentToSleep), the yawn starts there.
    const peak = run(a, [], 0, 12, [8, 10.2]);
    expect(a.mood).toBe('sleeping');
    // During the yawn window the mouth must open well beyond the sleeping value (0.12).
    expect(peak).toBeGreaterThan(0.35);
    // After the yawn the mouth settles back near the sleeping shape.
    let settled = 1;
    for (let t = 12; t < 13.5; t += 1 / 60) settled = Math.min(settled, a.update(t).mouthOpen);
    expect(a.pose.mouthOpen).toBeLessThan(0.25);
  });

  it('a curious mood never yawns', () => {
    const a = new EyeAnimator(defaultSettings(), 6);
    const peak = run(a, [lookingFace()], 0, 6, [4, 6]);
    expect(a.mood).toBe('happy');
    expect(peak).toBeLessThan(0.3);
  });

  it('a second sleep in the same session yawns again', () => {
    const a = new EyeAnimator(mergeSettings(defaultSettings(), { blink: { rate: 0, speed: 1 } }), 7);
    run(a, [], 0, 12); // falls asleep, yawns
    run(a, [lookingFace()], 12, 2); // someone appears: awake
    expect(a.mood).not.toBe('sleeping');
    const peak = run(a, [], 14, 12, [22, 24.5]); // gone again: sleeps and yawns again
    expect(a.mood).toBe('sleeping');
    expect(peak).toBeGreaterThan(0.35);
  });
});
