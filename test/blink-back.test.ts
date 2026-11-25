import { describe, expect, it } from 'vitest';
import { defaultSettings, EyeAnimator, mergeSettings, type FaceObservation } from '../src/core';
import { AttentionEstimator } from '../src/core/attention';
import { MultiCameraAttention } from '../src/core/multicamera';
import { lookingFace } from './helpers';

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

/** No natural blinks: blink rate 0, so every lid closure in a test is a mirrored blink. */
const noNaturalBlinks = () => mergeSettings(defaultSettings(), { blink: { rate: 0, speed: 1 } });

describe('blink back', () => {
  it('the estimator carries the person blink into the person state', () => {
    const e = new AttentionEstimator(defaultSettings().attention);
    e.ingest([{ ...lookingFace(), blink: 0.9 }], 0);
    expect(e.state.personBlink).toBeGreaterThan(0.85);
    const m = new MultiCameraAttention(defaultSettings().attention, false);
    m.ingest([{ ...lookingFace(), blink: 0.9 }], 0, [0]);
    expect(m.state.personBlink).toBeGreaterThan(0.85);
  });

  it('the eyes blink back when the person blinks', () => {
    const blinky = new EyeAnimator(noNaturalBlinks(), 1);
    // Half a second of calm looking, then one blink frame at t = 0.5.
    simulate(blinky, [lookingFace()], 0, 0.5);
    blinky.ingest([{ ...lookingFace(), blink: 1 }], 0.5);
    let maxLid = 0;
    let t = 0.5;
    while (t < 1.0) {
      if (Math.round(t * 60) % 3 === 0 && t > 0.51) blinky.ingest([{ ...lookingFace(), blink: 0 }], t);
      maxLid = Math.max(maxLid, blinky.update(t).upperLid);
      t += 1 / 60;
    }
    expect(maxLid).toBeGreaterThan(0.45);
  });

  it('no mirrored blink without a person blink', () => {
    const a = new EyeAnimator(noNaturalBlinks(), 2);
    simulate(a, [lookingFace()], 0, 1.0);
    let maxLid = 0;
    let t = 1.0;
    while (t < 1.4) {
      maxLid = Math.max(maxLid, a.update(t).upperLid);
      t += 1 / 60;
    }
    expect(maxLid).toBeLessThan(0.3);
  });

  it('continuous closed eyes do not spam mirrored blinks (cooldown)', () => {
    const a = new EyeAnimator(noNaturalBlinks(), 3);
    let episodes = 0;
    let wasClosed = false;
    let t = 0;
    while (t < 1.5) {
      if (Math.round(t * 60) % 3 === 0) a.ingest([{ ...lookingFace(), blink: 1 }], t);
      const lid = a.update(t).upperLid;
      if (lid > 0.45 && !wasClosed) episodes++;
      wasClosed = lid > 0.45;
      t += 1 / 60;
    }
    // A blink every ~0.7 s at most: 1.5 s of closed eyes gives a handful, not a flicker storm.
    expect(episodes).toBeGreaterThanOrEqual(1);
    expect(episodes).toBeLessThanOrEqual(3);
  });
});
