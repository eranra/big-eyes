import type { CameraInfo } from './ipc';
import type { Settings } from './settings';

/**
 * Words that built-in cameras use in their names:
 * macOS "FaceTime HD Camera", "MacBook Pro Camera", "MacBook Air Camera";
 * Windows and Linux "Integrated Camera", "Integrated Webcam", "HP TrueVision", "Built-in iSight", "Front Camera".
 */
const BUILT_IN_PATTERNS = [/facetime/i, /macbook/i, /imac/i, /built-?in/i, /integrated/i, /isight/i, /truevision/i, /front camera/i];

/** Names that look built-in but are not (phone cameras shared to the Mac, virtual cameras). */
const NOT_BUILT_IN = [/continuity/i, /iphone/i, /ipad/i, /desk view/i, /virtual/i, /obs/i];

export function isBuiltInCamera(label: string): boolean {
  return BUILT_IN_PATTERNS.some((p) => p.test(label)) && !NOT_BUILT_IN.some((p) => p.test(label));
}

/**
 * Picks the camera to open. Returns its `deviceId`, or null for "let the system choose".
 *
 * Order: the saved camera id, then a camera with the saved name (ids can change between runs or
 * when the camera is plugged in again), then the built-in camera when `cameraKind` is 'builtin'.
 */
export function chooseCamera(cameras: readonly CameraInfo[], s: Pick<Settings, 'cameraId' | 'cameraLabel' | 'cameraKind'>): string | null {
  if (s.cameraId && cameras.some((c) => c.deviceId === s.cameraId)) return s.cameraId;
  if (s.cameraLabel) {
    const wanted = s.cameraLabel.toLowerCase();
    const byName = cameras.find((c) => c.label.toLowerCase() === wanted) ?? cameras.find((c) => c.label.toLowerCase().includes(wanted));
    if (byName) return byName.deviceId;
  }
  if (s.cameraId === null && s.cameraLabel === null && s.cameraKind === 'builtin') {
    const builtIn = cameras.find((c) => isBuiltInCamera(c.label));
    if (builtIn) return builtIn.deviceId;
  }
  return null;
}
