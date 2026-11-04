import { describe, expect, it } from 'vitest';
import { ABSENT, AttentionEstimator, averageReference, defaultSettings, makeFace } from '../src/core';
import { awayFace, lookingFace, runEstimator } from './helpers';

describe('AttentionEstimator', () => {
  it('looking straight scores high, turned head scores low', () => {
    const e = new AttentionEstimator();
    expect(e.rawContactScore(lookingFace())).toBeGreaterThan(0.95);
    expect(e.rawContactScore(awayFace())).toBeLessThan(0.05);
  });

  it('eyes looking away (head straight) lowers the score', () => {
    const e = new AttentionEstimator();
    const face = makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, pitch: 10, gaze: { x: 0.9, y: 0.2 } });
    expect(e.rawContactScore(face)).toBeLessThan(0.3);
  });

  it('missing gaze uses the head angles only', () => {
    const e = new AttentionEstimator();
    const face = makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 2, pitch: 11, gaze: null });
    expect(e.rawContactScore(face)).toBeGreaterThan(0.9);
  });

  it('calibration moves the reference', () => {
    const s = defaultSettings().attention;
    s.reference = { yaw: 20, pitch: -10, gaze: { x: 0.3, y: 0 } };
    const e = new AttentionEstimator(s);
    const face = makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 20, pitch: -10, gaze: { x: 0.3, y: 0 } });
    expect(e.rawContactScore(face)).toBeGreaterThan(0.95);
    expect(e.rawContactScore(lookingFace())).toBeLessThan(0.2);
  });

  it('mirrors the position for the screen', () => {
    const e = new AttentionEstimator();
    // A person on the left of the camera image is on the right side of the screen.
    expect(e.screenPosition(lookingFace(0.2)).x).toBeGreaterThan(0.5);
    expect(e.screenPosition(lookingFace(0.8)).x).toBeLessThan(-0.5);
    // Image y grows down: a face near the top of the image is "up".
    expect(e.screenPosition(lookingFace(0.5, 0.1)).y).toBeGreaterThan(0.5);
    expect(new AttentionEstimator(undefined, true).screenPosition(lookingFace(0.2)).x).toBeLessThan(-0.5);
  });

  it('eye contact turns on and off with hysteresis', () => {
    const e = new AttentionEstimator();
    let t = runEstimator(e, [lookingFace()], 0, 1.5);
    expect(e.state.isMakingEyeContact).toBe(true);
    e.ingest([awayFace()], t);
    expect(e.state.isMakingEyeContact).toBe(true);
    t = runEstimator(e, [awayFace()], t + 0.05, 1.5);
    expect(e.state.isMakingEyeContact).toBe(false);
  });

  it('a short detection gap keeps the person present', () => {
    const e = new AttentionEstimator();
    const t = runEstimator(e, [lookingFace()], 0, 1);
    runEstimator(e, [], t, 0.6);
    expect(e.state.isPresent).toBe(true);
  });

  it('a long absence marks the person gone', () => {
    const e = new AttentionEstimator();
    const t = runEstimator(e, [lookingFace()], 0, 1);
    e.tick(t + 5);
    expect(e.state).toEqual(ABSENT);
  });

  it('chooses the biggest face and ignores low confidence', () => {
    const e = new AttentionEstimator();
    const small = lookingFace(0.2, 0.5, 0.1);
    const big = lookingFace(0.8, 0.5, 0.35);
    const weak = { ...lookingFace(0.5, 0.5, 0.6), confidence: 0.1 };
    expect(e.chooseFace([small, big, weak])).toBe(big);
    e.ingest([small, big, weak], 0);
    expect(e.state.position.x).toBeLessThan(0);
  });

  it('smooths the position', () => {
    const e = new AttentionEstimator();
    e.ingest([lookingFace(0.5)], 0);
    e.ingest([lookingFace(0)], 0.05);
    expect(e.state.position.x).toBeGreaterThan(0.1);
    expect(e.state.position.x).toBeLessThan(0.9);
  });

  it('calibration sample and average', () => {
    const e = new AttentionEstimator();
    expect(e.calibrationSample()).toBeNull();
    e.ingest([makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw: 5, pitch: -3, gaze: { x: 0.1, y: 0.2 } })], 0);
    expect(e.calibrationSample()).toEqual({ yaw: 5, pitch: -3, gaze: { x: 0.1, y: 0.2 } });
    const avg = averageReference([
      { yaw: 4, pitch: 0, gaze: { x: 0, y: 0 } },
      { yaw: 6, pitch: 2, gaze: { x: 0.2, y: -0.2 } },
    ])!;
    expect(avg.yaw).toBeCloseTo(5);
    expect(avg.pitch).toBeCloseTo(1);
    expect(avg.gaze.x).toBeCloseTo(0.1);
    expect(avg.gaze.y).toBeCloseTo(-0.1);
    expect(averageReference([])).toBeNull();
  });
});
