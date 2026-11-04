import { clamp, type Vec2 } from './math';

/**
 * One face found in one camera frame, as plain numbers.
 *
 * The renderer fills this from MediaPipe. All other core code works only with this type,
 * so it can be tested without a camera.
 */
export interface FaceObservation {
  /** Face center in the camera image, 0..1, origin top-left (y grows down). Not mirrored. */
  center: Vec2;
  /** Face width as a fraction of the image width. Bigger means closer. */
  size: number;
  /** Head rotation left/right in degrees. 0 = facing the camera. */
  yaw: number;
  /** Head rotation up/down in degrees. 0 = facing the camera. */
  pitch: number;
  /** Eye direction relative to the head, -1..1 per axis. `null` if unknown. */
  gaze: Vec2 | null;
  /** How much the person smiles, 0..1. */
  smile: number;
  /** How closed the person's eyes are, 0 (open) .. 1 (closed). */
  blink: number;
  /** Detector confidence, 0..1. */
  confidence: number;
  /** Which camera saw this face: 0 = the main camera, 1.. = extra cameras. */
  camera?: number;
}

export function makeFace(partial: Partial<FaceObservation> & Pick<FaceObservation, 'center' | 'size'>): FaceObservation {
  return { yaw: 0, pitch: 0, gaze: { x: 0, y: 0 }, smile: 0, blink: 0, confidence: 1, ...partial };
}

/** A normalized landmark point as produced by MediaPipe (x, y in 0..1, y down). */
export interface LandmarkPoint {
  x: number;
  y: number;
  z?: number;
}

/** A named score, as in MediaPipe `faceBlendshapes[i].categories`. */
export interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

/**
 * Head yaw and pitch (degrees) from MediaPipe's 4x4 facial transformation matrix.
 * The matrix is column-major, as MediaPipe delivers it.
 */
export function headAnglesFromMatrix(m: ArrayLike<number>): { yaw: number; pitch: number; roll: number } {
  if (m.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const r = (row: number, col: number): number => m[col * 4 + row] ?? 0;
  const toDeg = 180 / Math.PI;
  const yaw = Math.asin(clamp(-r(2, 0), -1, 1)) * toDeg;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * toDeg;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * toDeg;
  return { yaw, pitch, roll };
}

/**
 * Eye direction from MediaPipe blendshapes, -1..1 per axis.
 *
 * MediaPipe gives separate scores for "look in / out / up / down" per eye. We combine them into one vector.
 * x is positive toward the image right, y is positive up. The exact sign does not matter for eye contact,
 * because eye contact compares against a calibrated reference.
 */
export function gazeFromBlendshapes(categories: readonly BlendshapeCategory[]): Vec2 | null {
  const s = new Map(categories.map((c) => [c.categoryName, c.score]));
  const needed = ['eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookInRight', 'eyeLookOutRight'];
  if (!needed.every((name) => s.has(name))) return null;
  const v = (name: string): number => s.get(name) ?? 0;
  // "Left" in MediaPipe names is the person's left eye, which appears on the image right.
  const leftEye = v('eyeLookOutLeft') - v('eyeLookInLeft');
  const rightEye = v('eyeLookInRight') - v('eyeLookOutRight');
  const up = (v('eyeLookUpLeft') + v('eyeLookUpRight')) / 2;
  const down = (v('eyeLookDownLeft') + v('eyeLookDownRight')) / 2;
  return { x: clamp((leftEye + rightEye) / 2, -1, 1), y: clamp(up - down, -1, 1) };
}

const blendshape = (categories: readonly BlendshapeCategory[], name: string): number =>
  categories.find((c) => c.categoryName === name)?.score ?? 0;

/** Converts one face from a MediaPipe FaceLandmarker result into a `FaceObservation`. */
export function faceFromLandmarks(
  landmarks: readonly LandmarkPoint[],
  blendshapes: readonly BlendshapeCategory[] | undefined,
  matrix: ArrayLike<number> | undefined,
): FaceObservation | null {
  if (landmarks.length < 10) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of landmarks) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!(maxX > minX && maxY > minY)) return null;
  const angles = matrix ? headAnglesFromMatrix(matrix) : { yaw: 0, pitch: 0 };
  const shapes = blendshapes ?? [];
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    size: maxX - minX,
    yaw: angles.yaw,
    pitch: angles.pitch,
    gaze: shapes.length ? gazeFromBlendshapes(shapes) : null,
    smile: clamp((blendshape(shapes, 'mouthSmileLeft') + blendshape(shapes, 'mouthSmileRight')) / 2, 0, 1),
    blink: clamp((blendshape(shapes, 'eyeBlinkLeft') + blendshape(shapes, 'eyeBlinkRight')) / 2, 0, 1),
    confidence: 1,
  };
}
