import { describe, expect, it } from 'vitest';
import { chooseCameras, findCamera, isBuiltInCamera } from '../src/core/camera';

const cams = [
  { deviceId: 'c920', label: 'HD Pro Webcam C920' },
  { deviceId: 'mbp', label: 'MacBook Pro Camera (0000:0001)' },
  { deviceId: 'phone', label: "Eran's iPhone Camera" },
];

describe('built-in camera detection', () => {
  it('recognizes common built-in names', () => {
    for (const name of ['MacBook Pro Camera', 'FaceTime HD Camera', 'MacBook Air Camera', 'Integrated Webcam', 'Integrated Camera', 'HP TrueVision HD']) {
      expect(isBuiltInCamera(name)).toBe(true);
    }
  });

  it('rejects external, phone and virtual cameras', () => {
    for (const name of ['HD Pro Webcam C920', "Eran's iPhone Camera", 'Continuity Camera', 'OBS Virtual Camera', 'Desk View Camera']) {
      expect(isBuiltInCamera(name)).toBe(false);
    }
  });
});

describe('chooseCameras', () => {
  it('builtin picks the MacBook camera even when an external one is listed first', () => {
    expect(chooseCameras(cams, { mode: 'builtin' })).toEqual(['mbp']);
  });

  it('builtin without a built-in camera falls back to the system default', () => {
    expect(chooseCameras(cams.slice(0, 1), { mode: 'builtin' })).toEqual([]);
  });

  it('default leaves the choice to the system', () => {
    expect(chooseCameras(cams, { mode: 'default' })).toEqual([]);
  });

  it('all uses every real camera, built-in first, and skips phones', () => {
    expect(chooseCameras(cams, { mode: 'all' })).toEqual(['mbp', 'c920']);
    // Only a phone camera: use it rather than nothing.
    expect(chooseCameras(cams.slice(2), { mode: 'all' })).toEqual(['phone']);
  });

  it('selected keeps the saved order (first = main camera)', () => {
    const choice = {
      mode: 'selected' as const,
      cameras: [
        { id: 'c920', label: 'HD Pro Webcam C920' },
        { id: 'mbp', label: 'MacBook Pro Camera (0000:0001)' },
      ],
    };
    expect(chooseCameras(cams, choice)).toEqual(['c920', 'mbp']);
  });

  it('selected finds a camera by name when its id changed, and skips missing ones', () => {
    const choice = {
      mode: 'selected' as const,
      cameras: [
        { id: 'old-id', label: 'HD Pro Webcam C920' },
        { id: 'gone', label: 'Old Cam' },
        { id: '', label: 'macbook pro' },
      ],
    };
    expect(chooseCameras(cams, choice)).toEqual(['c920', 'mbp']);
  });

  it('selected with nothing connected falls back to the system default', () => {
    expect(chooseCameras(cams, { mode: 'selected', cameras: [{ id: 'gone', label: 'Old Cam' }] })).toEqual([]);
  });

  it('findCamera prefers the id', () => {
    expect(findCamera(cams, { id: 'mbp', label: 'HD Pro Webcam C920' })?.deviceId).toBe('mbp');
    expect(findCamera(cams, { id: '', label: '' })).toBeNull();
  });
});
