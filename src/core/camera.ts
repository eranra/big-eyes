import type { CameraInfo } from './ipc';
import type { CameraChoice, SavedCamera } from './settings';

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

/** Cameras that should not be used automatically ("all" mode): phone and virtual cameras. */
function isVirtualOrPhone(label: string): boolean {
  return NOT_BUILT_IN.some((p) => p.test(label));
}

/** Finds a saved camera in the list: by id first, then by exact name, then by part of the name. */
export function findCamera(cameras: readonly CameraInfo[], saved: SavedCamera): CameraInfo | null {
  const byId = saved.id ? cameras.find((c) => c.deviceId === saved.id) : undefined;
  if (byId) return byId;
  if (!saved.label) return null;
  const wanted = saved.label.toLowerCase();
  return cameras.find((c) => c.label.toLowerCase() === wanted) ?? cameras.find((c) => c.label.toLowerCase().includes(wanted)) ?? null;
}

/**
 * Picks the cameras to open, main camera first. Returns device ids.
 * An empty list means "let the system choose one" (the system default camera).
 *
 * - builtin: the built-in camera, else the system default;
 * - default: the system default;
 * - all: every camera, built-in first; phone and virtual cameras are skipped unless nothing else exists;
 * - selected: the chosen cameras that are connected, in the saved order. If none is connected: system default.
 */
export function chooseCameras(cameras: readonly CameraInfo[], choice: CameraChoice): string[] {
  switch (choice.mode) {
    case 'default':
      return [];
    case 'builtin': {
      const builtIn = cameras.find((c) => isBuiltInCamera(c.label));
      return builtIn ? [builtIn.deviceId] : [];
    }
    case 'all': {
      const real = cameras.filter((c) => !isVirtualOrPhone(c.label));
      const list = real.length ? real : [...cameras];
      list.sort((a, b) => Number(isBuiltInCamera(b.label)) - Number(isBuiltInCamera(a.label)));
      return list.map((c) => c.deviceId);
    }
    case 'selected': {
      const ids: string[] = [];
      for (const saved of choice.cameras) {
        const found = findCamera(cameras, saved);
        if (found && !ids.includes(found.deviceId)) ids.push(found.deviceId);
      }
      return ids;
    }
  }
}

/** True when two camera choices pick the same cameras. */
export function sameCameraChoice(a: CameraChoice, b: CameraChoice): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
