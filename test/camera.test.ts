import { describe, expect, it } from 'vitest';
import { chooseCamera, isBuiltInCamera } from '../src/core/camera';

const cams = [
  { deviceId: 'c920', label: 'HD Pro Webcam C920' },
  { deviceId: 'mbp', label: 'MacBook Pro Camera (0000:0001)' },
  { deviceId: 'phone', label: "Eran's iPhone Camera" },
];
const auto = { cameraId: null, cameraLabel: null } as const;

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

describe('chooseCamera', () => {
  it('builtin picks the MacBook camera even when an external one is listed first', () => {
    expect(chooseCamera(cams, { ...auto, cameraKind: 'builtin' })).toBe('mbp');
  });

  it('default leaves the choice to the system', () => {
    expect(chooseCamera(cams, { ...auto, cameraKind: 'default' })).toBeNull();
  });

  it('builtin without a built-in camera falls back to the system default', () => {
    expect(chooseCamera(cams.slice(0, 1), { ...auto, cameraKind: 'builtin' })).toBeNull();
  });

  it('a saved id wins, then a saved name', () => {
    expect(chooseCamera(cams, { cameraId: 'c920', cameraLabel: 'HD Pro Webcam C920', cameraKind: 'builtin' })).toBe('c920');
    // The id changed (for example after plugging the camera in again): match by name.
    expect(chooseCamera(cams, { cameraId: 'old-id', cameraLabel: 'HD Pro Webcam C920', cameraKind: 'builtin' })).toBe('c920');
    expect(chooseCamera(cams, { cameraId: null, cameraLabel: 'macbook pro', cameraKind: 'default' })).toBe('mbp');
  });

  it('a saved camera that is gone gives the system default, not the built-in camera', () => {
    expect(chooseCamera(cams, { cameraId: 'gone', cameraLabel: 'Old Cam', cameraKind: 'builtin' })).toBeNull();
  });
});
