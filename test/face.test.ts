import { describe, expect, it } from 'vitest';
import { faceFromLandmarks, gazeFromBlendshapes, headAnglesFromMatrix, type BlendshapeCategory } from '../src/core';

/** Column-major 4x4 rotation matrix for a yaw (around y) and pitch (around x), in degrees. */
function rotation(yawDeg: number, pitchDeg: number): number[] {
  const y = (yawDeg * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  // R = Ry(yaw) * Rx(pitch), row-major first.
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const rows = [
    [cy, sy * sp, sy * cp, 0],
    [0, cp, -sp, 0],
    [-sy, cy * sp, cy * cp, 0],
    [0, 0, 0, 1],
  ];
  const out: number[] = [];
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) out.push(rows[row]![col]!);
  return out;
}

const shapes = (values: Record<string, number>): BlendshapeCategory[] =>
  [
    'eyeLookInLeft',
    'eyeLookOutLeft',
    'eyeLookInRight',
    'eyeLookOutRight',
    'eyeLookUpLeft',
    'eyeLookUpRight',
    'eyeLookDownLeft',
    'eyeLookDownRight',
    'mouthSmileLeft',
    'mouthSmileRight',
    'eyeBlinkLeft',
    'eyeBlinkRight',
  ].map((categoryName) => ({ categoryName, score: values[categoryName] ?? 0 }));

describe('head angles from matrix', () => {
  it('identity is straight ahead', () => {
    const a = headAnglesFromMatrix(rotation(0, 0));
    expect(a.yaw).toBeCloseTo(0, 6);
    expect(a.pitch).toBeCloseTo(0, 6);
  });

  it('recovers yaw and pitch', () => {
    const a = headAnglesFromMatrix(rotation(25, -12));
    expect(a.yaw).toBeCloseTo(25, 4);
    expect(a.pitch).toBeCloseTo(-12, 4);
  });

  it('handles short input', () => {
    expect(headAnglesFromMatrix([1, 2, 3])).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
});

describe('gaze from blendshapes', () => {
  it('centered eyes give zero', () => {
    expect(gazeFromBlendshapes(shapes({}))).toEqual({ x: 0, y: 0 });
  });

  it('both eyes looking to the image right', () => {
    // Person's left eye looks out, right eye looks in: both turn toward the image right.
    const g = gazeFromBlendshapes(shapes({ eyeLookOutLeft: 0.8, eyeLookInRight: 0.8 }))!;
    expect(g.x).toBeCloseTo(0.8, 6);
  });

  it('looking up and down', () => {
    expect(gazeFromBlendshapes(shapes({ eyeLookUpLeft: 0.6, eyeLookUpRight: 0.6 }))!.y).toBeCloseTo(0.6, 6);
    expect(gazeFromBlendshapes(shapes({ eyeLookDownLeft: 0.4, eyeLookDownRight: 0.4 }))!.y).toBeCloseTo(-0.4, 6);
  });

  it('missing categories give null', () => {
    expect(gazeFromBlendshapes([{ categoryName: 'mouthSmileLeft', score: 1 }])).toBeNull();
  });
});

describe('face from landmarks', () => {
  const square = Array.from({ length: 20 }, (_, i) => ({ x: 0.3 + (i % 5) * 0.1, y: 0.2 + Math.floor(i / 5) * 0.1 }));

  it('computes center, size, angles, smile and blink', () => {
    const f = faceFromLandmarks(
      square,
      shapes({ mouthSmileLeft: 0.6, mouthSmileRight: 0.8, eyeBlinkLeft: 1, eyeBlinkRight: 0 }),
      rotation(10, 5),
    )!;
    expect(f.center.x).toBeCloseTo(0.5, 9);
    expect(f.center.y).toBeCloseTo(0.35, 9);
    expect(f.size).toBeCloseTo(0.4, 9);
    expect(f.yaw).toBeCloseTo(10, 4);
    expect(f.pitch).toBeCloseTo(5, 4);
    expect(f.smile).toBeCloseTo(0.7, 9);
    expect(f.blink).toBeCloseTo(0.5, 9);
    expect(f.gaze).toEqual({ x: 0, y: 0 });
  });

  it('works without blendshapes and matrix', () => {
    const f = faceFromLandmarks(square, undefined, undefined)!;
    expect(f.gaze).toBeNull();
    expect(f.yaw).toBe(0);
  });

  it('rejects degenerate input', () => {
    expect(faceFromLandmarks(square.slice(0, 3), undefined, undefined)).toBeNull();
    expect(faceFromLandmarks(Array(20).fill({ x: 0.5, y: 0.5 }), undefined, undefined)).toBeNull();
  });
});
