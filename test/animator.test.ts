import { describe, expect, it } from 'vitest';
import { defaultSettings, EyeAnimator, isFiniteVec, length, MOODS, staticPose, type FaceObservation } from '../src/core';
import { awayFace, lookingFace } from './helpers';

/** Runs at 60 fps with camera frames at 20 fps. Returns the end time. */
function simulate(a: EyeAnimator, faces: FaceObservation[], from: number, seconds: number): number {
  let t = from;
  let frame = 0;
  while (t < from + seconds) {
    if (frame % 3 === 0) a.ingest(faces, t);
    a.update(t);
    t += 1 / 60;
    frame++;
  }
  return t;
}

describe('EyeAnimator', () => {
  it('keeps pose values in range through a long script', () => {
    const a = new EyeAnimator(defaultSettings(), 9);
    let t = 0;
    const script: Array<[FaceObservation[], number]> = [
      [[], 10],
      [[lookingFace(0.2)], 3],
      [[awayFace(0.8)], 4],
      [[lookingFace(0.7, 0.3)], 3],
    ];
    for (const [faces, seconds] of script) {
      const end = t + seconds;
      let frame = 0;
      while (t < end) {
        if (frame++ % 3 === 0) a.ingest(faces, t);
        const p = a.update(t);
        expect(isFiniteVec(p.gaze) && isFiniteVec(p.drift)).toBe(true);
        expect(p.upperLid).toBeGreaterThanOrEqual(0);
        expect(p.upperLid).toBeLessThanOrEqual(1);
        expect(p.smile).toBeGreaterThanOrEqual(0);
        expect(p.smile).toBeLessThanOrEqual(1);
        expect(p.scale).toBeGreaterThan(0.7);
        expect(p.scale).toBeLessThan(1.3);
        expect(length(p.gaze)).toBeLessThan(1.3);
        t += 1 / 60;
      }
    }
  });

  it('eyes follow the person', () => {
    const a = new EyeAnimator(defaultSettings(), 1);
    // Person on the left of the camera image and high = right and up on the screen.
    simulate(a, [lookingFace(0.15, 0.2)], 0, 3);
    expect(a.pose.gaze.x).toBeGreaterThan(0.4);
    expect(a.pose.gaze.y).toBeGreaterThan(0.2);
    expect(a.pose.drift.x).toBeGreaterThan(0.05);
  });

  it('shows no text by default', () => {
    const a = new EyeAnimator(defaultSettings(), 2);
    simulate(a, [lookingFace()], 0, 3);
    expect(a.mood).toBe('happy');
    expect(a.pose.captionOpacity).toBeLessThan(0.05);
  });

  it('eye contact shows Welcome and a smile when text is on', () => {
    const a = new EyeAnimator({ ...defaultSettings(), showCaptions: true }, 2);
    simulate(a, [lookingFace()], 0, 3);
    expect(a.mood).toBe('happy');
    expect(a.pose.caption).toBe('Welcome');
    expect(a.pose.captionOpacity).toBeGreaterThan(0.8);
    expect(a.pose.smile).toBeGreaterThan(0.4);
  });

  it('the eyes smile more when the person smiles', () => {
    const plain = new EyeAnimator(defaultSettings(), 2);
    const smiling = new EyeAnimator(defaultSettings(), 2);
    simulate(plain, [lookingFace()], 0, 3);
    simulate(smiling, [{ ...lookingFace(), smile: 1 }], 0, 3);
    expect(smiling.pose.smile).toBeGreaterThan(plain.pose.smile + 0.1);
  });

  it('looking away shows Bored and heavy lids', () => {
    const a = new EyeAnimator({ ...defaultSettings(), showCaptions: true }, 3);
    simulate(a, [awayFace(0.2)], 0, 6);
    expect(a.mood).toBe('bored');
    expect(a.pose.caption).toBe('Bored');
    expect(a.pose.upperLid).toBeGreaterThan(0.35);
  });

  it('an empty room falls asleep', () => {
    const a = new EyeAnimator(defaultSettings(), 4);
    simulate(a, [], 0, 12);
    expect(a.mood).toBe('sleeping');
    expect(a.pose.upperLid).toBeGreaterThan(0.85);
    expect(a.pose.sleepOpacity).toBeGreaterThan(0.5);
  });

  it('eyes keep moving while idle', () => {
    const a = new EyeAnimator(defaultSettings(), 5);
    const seen = new Set<string>();
    for (let t = 0; t < 5; t += 1 / 60) {
      const p = a.update(t);
      seen.add(`${Math.round(p.gaze.x * 20)},${Math.round(p.gaze.y * 20)}`);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('shows a message override and custom texts', () => {
    const a = new EyeAnimator(defaultSettings(), 6);
    a.messageOverride = 'Look into my eyes';
    simulate(a, [], 0, 1.5);
    expect(a.pose.caption).toBe('Look into my eyes');
    expect(a.pose.captionOpacity).toBeGreaterThan(0.7);

    const s = { ...defaultSettings(), showCaptions: true };
    s.welcomeText = 'Hi there';
    const b = new EyeAnimator(s, 7);
    simulate(b, [lookingFace()], 0, 3);
    expect(b.pose.caption).toBe('Hi there');
  });

  it('static poses exist for every mood', () => {
    for (const mood of MOODS) expect(staticPose(mood).mood).toBe(mood);
  });
});
