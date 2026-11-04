import { describe, expect, it } from 'vitest';
import { AttentionEstimator, defaultSettings, EyeAnimator, mergeSettings, MoodMachine, type FaceObservation, type PersonState } from '../src/core';
import { awayFace, lookingFace, runEstimator } from './helpers';

const onCamera = (face: FaceObservation, camera: number): FaceObservation => ({ ...face, camera });

describe('several cameras', () => {
  it('the main camera decides position and eye contact', () => {
    const e = new AttentionEstimator();
    // Main camera: person on the right side of the screen, looking at the eyes.
    // Extra camera: sees the same person from the side (turned away).
    runEstimator(e, [onCamera(lookingFace(0.2), 0), onCamera(awayFace(0.8), 1)], 0, 1.5);
    expect(e.state.position.x).toBeGreaterThan(0.4);
    expect(e.state.isMakingEyeContact).toBe(true);
    expect(e.state.seenByMainCamera).toBe(true);
  });

  it('an extra camera keeps the person present when the main camera loses them', () => {
    const e = new AttentionEstimator();
    let t = runEstimator(e, [onCamera(lookingFace(0.2), 0)], 0, 1);
    const position = e.state.position.x;
    t = runEstimator(e, [onCamera(awayFace(), 1)], t, 4);
    expect(e.state.isPresent).toBe(true);
    expect(e.state.seenByMainCamera).toBe(false);
    // Position stays where the main camera last saw the person; eye contact fades.
    expect(e.state.position.x).toBeCloseTo(position, 5);
    expect(e.state.isMakingEyeContact).toBe(false);
  });

  it('a face on an extra camera only still wakes the eyes', () => {
    const e = new AttentionEstimator();
    e.ingest([onCamera(awayFace(), 2)], 0);
    expect(e.state.isPresent).toBe(true);
  });

  it('faces without a camera index count as the main camera (one camera, older data)', () => {
    const e = new AttentionEstimator();
    runEstimator(e, [lookingFace(0.2)], 0, 1);
    expect(e.state.seenByMainCamera).toBe(true);
  });
});

describe('smile detection', () => {
  const smiling = (smile: number): FaceObservation => ({ ...lookingFace(), smile });

  it('turns on above the threshold and off with hysteresis', () => {
    const e = new AttentionEstimator();
    let t = runEstimator(e, [smiling(0.8)], 0, 1);
    expect(e.state.isSmiling).toBe(true);
    // A smaller smile (0.35) is between the off and on thresholds: still smiling.
    t = runEstimator(e, [smiling(0.35)], t, 1);
    expect(e.state.isSmiling).toBe(true);
    runEstimator(e, [smiling(0.05)], t, 1);
    expect(e.state.isSmiling).toBe(false);
  });

  it('a small smile does not count', () => {
    const e = new AttentionEstimator();
    runEstimator(e, [smiling(0.3)], 0, 2);
    expect(e.state.isSmiling).toBe(false);
  });

  it('a smile seen by an extra camera counts', () => {
    const e = new AttentionEstimator();
    runEstimator(e, [onCamera({ ...awayFace(), smile: 0.9 }, 1)], 0, 1);
    expect(e.state.isSmiling).toBe(true);
  });
});

describe('smile back', () => {
  const person = (contact: boolean, smiling: boolean): PersonState => ({
    isPresent: true,
    position: { x: 0, y: 0 },
    size: 0.3,
    contactScore: contact ? 1 : 0,
    isMakingEyeContact: contact,
    smile: smiling ? 0.8 : 0,
    isSmiling: smiling,
    seenByMainCamera: true,
    lastSeen: 0,
  });
  const run = (m: MoodMachine, p: PersonState, from: number, seconds: number): number => {
    let t = from;
    while (t < from + seconds) {
      m.update(p, t);
      t += 0.05;
    }
    return t;
  };

  it('smiling at the eyes makes them delighted', () => {
    const m = new MoodMachine();
    run(m, person(true, true), 0, 1);
    expect(m.mood).toBe('delighted');
  });

  it('smiling without looking at the eyes is not enough', () => {
    const m = new MoodMachine();
    run(m, person(false, true), 0, 1.5);
    expect(m.mood).not.toBe('delighted');
  });

  it('stopping the smile goes back to happy after a moment', () => {
    const m = new MoodMachine();
    let t = run(m, person(true, true), 0, 1);
    t = run(m, person(true, false), t, 0.5);
    expect(m.mood).toBe('delighted');
    run(m, person(true, false), t, 1.5);
    expect(m.mood).toBe('happy');
  });

  it('can be turned off', () => {
    const s = defaultSettings().mood;
    s.smileBack = false;
    const m = new MoodMachine(s);
    run(m, person(true, true), 0, 2);
    expect(m.mood).toBe('happy');
  });

  it('the animator shows a big open smile, and a closed small one when just happy', () => {
    const smilingFace = { ...lookingFace(), smile: 0.9 };
    const a = new EyeAnimator(defaultSettings(), 4);
    for (let t = 0, f = 0; t < 3; t += 1 / 60, f++) {
      if (f % 3 === 0) a.ingest([smilingFace], t);
      a.update(t);
    }
    expect(a.mood).toBe('delighted');
    expect(a.pose.mouthSmile).toBeGreaterThan(0.8);
    expect(a.pose.mouthOpen).toBeGreaterThan(0.3);
    expect(a.pose.smile).toBeGreaterThan(0.8);

    const b = new EyeAnimator(defaultSettings(), 4);
    for (let t = 0, f = 0; t < 3; t += 1 / 60, f++) {
      if (f % 3 === 0) b.ingest([lookingFace()], t);
      b.update(t);
    }
    expect(b.mood).toBe('happy');
    expect(b.pose.mouthOpen).toBeLessThan(0.1);
    expect(b.pose.mouthSmile).toBeLessThan(a.pose.mouthSmile);
  });

  it('bored eyes frown a little; the mouth can be hidden', () => {
    const a = new EyeAnimator(defaultSettings(), 5);
    for (let t = 0, f = 0; t < 6; t += 1 / 60, f++) {
      if (f % 3 === 0) a.ingest([awayFace()], t);
      a.update(t);
    }
    expect(a.mood).toBe('bored');
    expect(a.pose.mouthSmile).toBeLessThan(0);

    const hidden = new EyeAnimator(mergeSettings(defaultSettings(), { look: { showMouth: false } }), 5);
    for (let t = 0; t < 2; t += 1 / 60) hidden.update(t);
    expect(hidden.pose.mouthOpacity).toBeLessThan(0.05);
  });
});
