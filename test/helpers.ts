import { AttentionEstimator, makeFace, type FaceObservation } from '../src/core';

/** A face looking straight at the eyes (matches the default calibration reference). */
export function lookingFace(x = 0.5, y = 0.5, size = 0.3): FaceObservation {
  return makeFace({ center: { x, y }, size, yaw: 0, pitch: 10, gaze: { x: 0, y: 0.2 } });
}

/** A face turned away to the side. */
export function awayFace(x = 0.5, y = 0.5): FaceObservation {
  return makeFace({ center: { x, y }, size: 0.3, yaw: 40, pitch: 0, gaze: { x: 0.8, y: 0 } });
}

/** Feeds the same faces at 20 frames per second for `seconds`. Returns the end time. */
export function runEstimator(e: AttentionEstimator, faces: FaceObservation[], from: number, seconds: number): number {
  let t = from;
  while (t < from + seconds) {
    e.ingest(faces, t);
    t += 0.05;
  }
  return t;
}
