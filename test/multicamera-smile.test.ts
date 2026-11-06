import { describe, expect, it } from 'vitest';
import {
  AttentionEstimator,
  defaultSettings,
  EyeAnimator,
  findCalibration,
  makeFace,
  mergeSettings,
  MoodMachine,
  MultiCameraAttention,
  normalizeSettings,
  PresenceCheck,
  withCalibration,
  type CameraCalibration,
  type FaceObservation,
  type PersonState,
} from '../src/core';
import { awayFace, lookingFace, runEstimator } from './helpers';

// Two cameras: the built-in one in the laptop, and a webcam on the external screen, seen from the side.
const BUILTIN = { index: 0, label: 'MacBook Pro Camera (0000:0001)', id: 'mbp' };
const WEBCAM = { index: 1, label: 'HD Pro Webcam C920 (046d:082d)', id: 'c920' };
const calib = (label: string, id: string, yaw: number, pitch = 10): CameraCalibration => ({
  label,
  id,
  reference: { yaw, pitch, gaze: { x: 0, y: 0.2 } },
  faceCenter: { x: 0.5, y: 0.5 },
  date: '2026-11-06',
});
// From the webcam's side position, "looking at the eyes" means a head turned 30 degrees.
const calibrations = [calib(BUILTIN.label, BUILTIN.id, 0), calib(WEBCAM.label, WEBCAM.id, 30)];
const s = defaultSettings();

/** A face seen by `camera` with the head at `yaw` (looking at the eyes when yaw matches that camera's reference). */
const face = (camera: number, yaw: number, smile = 0): FaceObservation => ({
  ...makeFace({ center: { x: 0.5, y: 0.5 }, size: 0.3, yaw, pitch: 10, gaze: { x: 0, y: 0.2 } }),
  smile,
  camera,
});

function multi(cals = calibrations): MultiCameraAttention {
  const m = new MultiCameraAttention(s.attention, false, cals);
  m.setCameras([BUILTIN, WEBCAM]);
  return m;
}

/** Feeds both cameras at 20 fps. `frame(t)` returns the faces of that moment. */
function feed(m: MultiCameraAttention, from: number, to: number, frame: (t: number) => FaceObservation[]): void {
  for (let t = from; t < to - 1e-9; t += 0.05) m.ingest(frame(t), t, [0, 1]);
}

describe('each camera works on its own, with its own calibration', () => {
  it('looking at the eyes counts on the camera whose calibration matches', () => {
    // You look at the eyes: the built-in camera sees yaw 0 (its reference), the webcam sees yaw 30 (its reference).
    const m = multi();
    feed(m, 0, 2, () => [face(0, 0), face(1, 30)]);
    expect(m.camera(0).state.isMakingEyeContact).toBe(true);
    expect(m.camera(1).state.isMakingEyeContact).toBe(true);
    expect(m.state.isMakingEyeContact).toBe(true);
  });

  it('only the webcam sees the eye contact: it still counts (any camera wins)', () => {
    const m = multi();
    // The built-in camera sees a head turned away; the webcam, from its angle, sees eye contact.
    feed(m, 0, 2, () => [face(0, 45), face(1, 30)]);
    expect(m.camera(0).state.isMakingEyeContact).toBe(false);
    expect(m.camera(1).state.isMakingEyeContact).toBe(true);
    expect(m.state.isMakingEyeContact).toBe(true);
  });

  it('no camera sees eye contact: nobody is looking', () => {
    const m = multi();
    feed(m, 0, 3, () => [face(0, 60), face(1, -40)]);
    expect(m.state.isPresent).toBe(true);
    expect(m.state.isMakingEyeContact).toBe(false);
  });

  it("each camera's timer counts on its own; times are never added across cameras", () => {
    const m = multi();
    // 3 s of eye contact on the built-in camera only.
    feed(m, 0, 3, () => [face(0, 0), face(1, -40)]);
    expect(m.state.contactSeconds).toBeGreaterThan(2.3);
    // Then you turn so that only the webcam sees eye contact: its own count starts from zero.
    feed(m, 3, 4, () => [face(0, 60), face(1, 30)]);
    expect(m.camera(0).state.contactSeconds).toBe(0);
    expect(m.state.contactSeconds).toBeLessThan(1);
  });

  it('the same camera must see the smile and the eye contact', () => {
    const m = multi();
    // The built-in camera sees eye contact without a smile; the webcam sees a smile but no eye contact.
    feed(m, 0, 3, () => [face(0, 0, 0), face(1, -40, 0.9)]);
    expect(m.state.isSmiling).toBe(true);
    expect(m.state.isMakingEyeContact).toBe(true);
    expect(m.state.smileContactSeconds).toBe(0);
    // Now the built-in camera sees both.
    feed(m, 3, 4, () => [face(0, 0, 0.9), face(1, -40, 0.9)]);
    expect(m.state.smileContactSeconds).toBeGreaterThan(0.3);
  });

  it('an uncalibrated camera next to other cameras counts for presence only', () => {
    const m = multi([calib(BUILTIN.label, BUILTIN.id, 0)]);
    // Built-in camera sees nobody; the uncalibrated webcam sees a face looking straight into it.
    feed(m, 0, 2, () => [face(1, 0)]);
    expect(m.state.isPresent).toBe(true);
    expect(m.camera(1).contactAllowed).toBe(false);
    expect(m.state.isMakingEyeContact).toBe(false);
  });

  it('a single uncalibrated camera uses the default values (as before)', () => {
    const m = new MultiCameraAttention(s.attention, false, []);
    m.setCameras([WEBCAM]);
    for (let t = 0; t < 2; t += 0.05) m.ingest([lookingFace()].map((f) => ({ ...f, camera: 1 })), t, [1]);
    expect(m.camera(1).contactAllowed).toBe(true);
    expect(m.state.isMakingEyeContact).toBe(true);
  });

  it('a face on any camera keeps the person present', () => {
    const m = multi();
    feed(m, 0, 1, () => [face(1, 80)]);
    expect(m.state.isPresent).toBe(true);
  });
});

describe('the first camera to reach it wins: moods, look-to-close, waiting', () => {
  it('happy and smiling back come from one camera reaching the time on its own', () => {
    const person = (contactSeconds: number, smileContactSeconds: number): PersonState => ({
      isPresent: true,
      position: { x: 0, y: 0 },
      size: 0.3,
      contactScore: contactSeconds > 0 ? 1 : 0,
      isMakingEyeContact: contactSeconds > 0,
      smile: smileContactSeconds > 0 ? 0.8 : 0,
      isSmiling: smileContactSeconds > 0,
      contactSeconds,
      smileContactSeconds,
      lastSeen: 0,
    });
    const mood = new MoodMachine();
    mood.update(person(0.2, 0), 0);
    expect(mood.mood).toBe('curious');
    mood.update(person(0.5, 0), 0.3);
    expect(mood.mood).toBe('happy');
    mood.update(person(0.6, 0.35), 0.4);
    expect(mood.mood).toBe('delighted');
  });

  it('look-to-close: one camera holding eye contact long enough closes the eyes', () => {
    const settings = mergeSettings(defaultSettings(), { lookToClose: true, lookToCloseSeconds: 2, calibrations });
    const a = new EyeAnimator(settings, 1);
    a.setCameras([BUILTIN, WEBCAM]);
    let t = 0;
    // Only the webcam sees eye contact.
    for (; t < 5 && !a.wantsToClose; t += 1 / 60) {
      a.ingest([face(0, 70), face(1, 30)], t, [0, 1]);
      a.update(t);
    }
    expect(a.wantsToClose).toBe(true);
  });

  it('look-to-close does not add up short looks on different cameras', () => {
    const settings = mergeSettings(defaultSettings(), { lookToClose: true, lookToCloseSeconds: 2, calibrations });
    const a = new EyeAnimator(settings, 1);
    a.setCameras([BUILTIN, WEBCAM]);
    // 1.2 s on the built-in camera, then 1.2 s on the webcam, again and again: never 2 s on one camera.
    for (let t = 0; t < 10; t += 1 / 60) {
      const builtIn = Math.floor(t / 1.2) % 2 === 0;
      a.ingest(builtIn ? [face(0, 0), face(1, -40)] : [face(0, 70), face(1, 30)], t, [0, 1]);
      a.update(t);
    }
    expect(a.wantsToClose).toBe(false);
  });

  it('wait while looking: any calibrated camera seeing eye contact makes the eyes wait', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    p.start(0, s.attention, false, calibrations, [BUILTIN, WEBCAM]);
    let result: string | null = null;
    for (let t = 0.05; t < 5 && !result; t += 0.05) {
      p.report([face(0, 70), face(1, 30)], t, [0, 1]);
      result = p.result(t);
    }
    expect(result).toBe('watched');
  });

  it('wait while looking: nobody looking on any camera shows the eyes', () => {
    const p = new PresenceCheck({ checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 0, recheckSeconds: 15 });
    p.start(0, s.attention, false, calibrations, [BUILTIN, WEBCAM]);
    let result: string | null = null;
    for (let t = 0.05; t < 6 && !result; t += 0.05) {
      p.report([face(0, 70), face(1, -40)], t, [0, 1]);
      result = p.result(t);
    }
    expect(result).toBe('nobody');
  });
});

describe('calibration is saved per camera', () => {
  it('found by id, or by name when the id changed', () => {
    expect(findCalibration(calibrations, { id: 'c920', label: 'x' })?.label).toBe(WEBCAM.label);
    expect(findCalibration(calibrations, { id: 'new-id', label: WEBCAM.label })?.reference.yaw).toBe(30);
    expect(findCalibration(calibrations, { id: 'zzz', label: 'Other Camera' })).toBeNull();
  });

  it('calibrating one camera replaces only that camera', () => {
    const updated = withCalibration(calibrations, calib(WEBCAM.label, WEBCAM.id, 25));
    expect(updated).toHaveLength(2);
    expect(findCalibration(updated, WEBCAM)?.reference.yaw).toBe(25);
    expect(findCalibration(updated, BUILTIN)?.reference.yaw).toBe(0);
  });

  it('kept when the camera choice changes (all cameras, one camera, back)', () => {
    let st = mergeSettings(defaultSettings(), { calibrations, cameras: { mode: 'all' } });
    st = mergeSettings(st, { cameras: { mode: 'builtin' } });
    st = mergeSettings(st, { cameras: { mode: 'selected', cameras: [{ id: 'c920', label: WEBCAM.label }] } });
    expect(st.calibrations).toEqual(calibrations);
    // With only the webcam open, it uses its own calibration.
    const m = new MultiCameraAttention(st.attention, false, st.calibrations);
    m.setCameras([{ ...WEBCAM, index: 0 }]);
    for (let t = 0; t < 2; t += 0.05) m.ingest([face(0, 30)], t, [0]);
    expect(m.state.isMakingEyeContact).toBe(true);
  });

  it('validated and saved through the settings file', () => {
    const st = normalizeSettings({ calibrations: [...calibrations, { label: '' }, 'x', { label: 'Cam', reference: { yaw: 500 } }] });
    expect(st.calibrations.map((c) => c.label)).toEqual([BUILTIN.label, WEBCAM.label, 'Cam']);
    expect(st.calibrations[2]!.reference.yaw).toBe(90);
    expect(normalizeSettings(JSON.parse(JSON.stringify(st))).calibrations).toEqual(st.calibrations);
  });

  it('the old single calibration is used by the built-in camera', () => {
    const old = mergeSettings(defaultSettings(), { attention: { reference: { yaw: 3, pitch: 12, gaze: { x: 0.1, y: 0.1 } } } });
    const m = new MultiCameraAttention(old.attention, false, old.calibrations);
    m.setCameras([BUILTIN, WEBCAM]);
    expect(m.calibrationOf(0)?.reference.yaw).toBe(3);
    expect(m.calibrationOf(1)).toBeNull();
  });
});

describe('one camera, as before', () => {
  it('eye contact turns on with a single camera and no calibration', () => {
    const e = new AttentionEstimator();
    runEstimator(e, [lookingFace()], 0, 1.5);
    expect(e.state.isMakingEyeContact).toBe(true);
    expect(e.state.contactSeconds).toBeGreaterThan(0.5);
    runEstimator(e, [awayFace()], 2, 2);
    expect(e.state.contactSeconds).toBe(0);
  });
});
