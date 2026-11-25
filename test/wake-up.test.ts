import { describe, expect, it } from 'vitest';
import { defaultSettings, EyeAnimator, type FaceObservation } from '../src/core';
import { awayFace, lookingFace } from './helpers';

/** Runs at 60 fps with camera frames at 20 fps. Returns the end time. */
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

describe('wake-up personality', () => {
  it('after a long absence the eyes welcome the person warmly, even without eye contact', () => {
    const a = new EyeAnimator(defaultSettings(), 1);
    // Gone for 6 minutes (absentToSleep is 8 s, so the eyes are deep asleep).
    simulate(a, [], 0, 360);
    // The person returns but looks AWAY (no eye contact): a plain curious/bored reaction normally.
    simulate(a, [awayFace()], 360, 1.2);
    expect(a.person.isPresent).toBe(true);
    expect(a.person.isMakingEyeContact).toBe(false);
    // The welcome still shows: a big smile within the first second.
    expect(a.pose.smile).toBeGreaterThan(0.5);
    expect(a.pose.browLift).toBeGreaterThan(0.3);
  });

  it('a short absence gets the normal reaction: no welcome without eye contact', () => {
    const a = new EyeAnimator(defaultSettings(), 2);
    simulate(a, [awayFace()], 0, 3); // person present, looking away (bored territory)
    simulate(a, [], 3, 20); // gone 20 s: asleep, but not a "long" absence
    simulate(a, [awayFace()], 23, 1.2);
    expect(a.person.isPresent).toBe(true);
    // No big welcome: the smile stays low without eye contact.
    expect(a.pose.smile).toBeLessThan(0.35);
  });

  it('the welcome fades back to normal behavior after a couple of seconds', () => {
    const a = new EyeAnimator(defaultSettings(), 3);
    simulate(a, [], 0, 360);
    simulate(a, [awayFace()], 360, 4); // person stays but never makes eye contact
    // After the welcome window the smile falls back toward the bored/curious range.
    expect(a.pose.smile).toBeLessThan(0.45);
  });

  it('a normal return with eye contact is unaffected (happy as always)', () => {
    const a = new EyeAnimator(defaultSettings(), 4);
    simulate(a, [], 0, 360);
    simulate(a, [lookingFace()], 360, 2);
    expect(a.mood).toBe('happy');
    expect(a.pose.smile).toBeGreaterThan(0.5);
  });
});
