/**
 * "Is someone looking at the screen?" check that runs while the eyes are hidden.
 *
 * When the idle time is reached, the app does not show the eyes at once. It first opens the camera for
 * a short check. If a person faces the screen, the eyes wait, and the app checks again later.
 * This keeps the camera off almost all the time while you work, and it still notices a reader who
 * does not touch the keyboard or mouse.
 */
import type { FaceObservation } from './face';

export interface PresenceTiming {
  /** How long one camera check looks at frames (seconds), counted from the first frame. */
  checkSeconds: number;
  /** If the camera sends no frame for this long (seconds), give up the check and show the eyes. */
  startTimeoutSeconds: number;
  /**
   * Frames in the first seconds after the camera turns on are often dark while the camera adjusts its exposure.
   * A face in them still counts, but "nobody" is only decided after this warm-up plus `checkSeconds`.
   */
  warmupSeconds: number;
  /** After a check that saw someone, wait this long before checking again (seconds). */
  recheckSeconds: number;
}

export const DEFAULT_PRESENCE_TIMING: PresenceTiming = { checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 1, recheckSeconds: 15 };

/** Head turned further than this (degrees) does not count as "looking at the screen". */
export const WATCHING_MAX_YAW = 35;
export const WATCHING_MAX_PITCH = 35;

/**
 * True when a face from the main camera looks roughly toward the screen. Reading counts: people look a
 * bit down at the text, so this is much wider than eye contact.
 */
export function isWatching(face: FaceObservation): boolean {
  if ((face.camera ?? 0) !== 0) return false;
  if (face.confidence < 0.5 || face.size < 0.05) return false;
  return Math.abs(face.yaw) <= WATCHING_MAX_YAW && Math.abs(face.pitch) <= WATCHING_MAX_PITCH + 10;
}

export type PresencePhase = 'idle' | 'checking' | 'watched';

/**
 * Small state machine for the presence check.
 *
 * - `request(now)` starts a check (the camera opens). Returns false if a check is not due yet.
 * - `report(faces, now)` gives the faces of each camera frame during the check.
 * - `result(now)` returns 'watched' (someone looks: wait), 'nobody' (show the eyes), or null (still checking).
 * - `reset()` when the user uses the keyboard or mouse again.
 */
export class PresenceCheck {
  phase: PresencePhase = 'idle';
  private startedAt = 0;
  /** Time of the first camera frame in this check. The camera and the face model can take seconds to start. */
  private firstFrameAt: number | null = null;
  private sawWatcher = false;
  private nextCheckAt = 0;

  constructor(readonly timing: PresenceTiming = DEFAULT_PRESENCE_TIMING) {}

  /** True when a camera check should run now. */
  due(now: number): boolean {
    return this.phase !== 'checking' && now >= this.nextCheckAt;
  }

  start(now: number): void {
    this.phase = 'checking';
    this.startedAt = now;
    this.firstFrameAt = null;
    this.sawWatcher = false;
  }

  /** Faces from one camera frame (an empty list is a frame with nobody in it). */
  report(faces: readonly FaceObservation[], now: number): void {
    if (this.phase !== 'checking') return;
    this.firstFrameAt ??= now;
    if (faces.some(isWatching)) this.sawWatcher = true;
  }

  /** Ends the check early when a watcher is found, or after `checkSeconds`. */
  result(now: number): 'watched' | 'nobody' | null {
    if (this.phase !== 'checking') return null;
    if (this.sawWatcher) {
      this.phase = 'watched';
      this.nextCheckAt = now + this.timing.recheckSeconds;
      return 'watched';
    }
    const looked = this.firstFrameAt !== null && now - this.firstFrameAt >= this.timing.warmupSeconds + this.timing.checkSeconds;
    const cameraSilent = this.firstFrameAt === null && now - this.startedAt >= this.timing.startTimeoutSeconds;
    if (looked || cameraSilent) {
      this.phase = 'idle';
      return 'nobody';
    }
    return null;
  }

  /** The camera could not be used: do not block the eyes because of it. */
  fail(): void {
    this.phase = 'idle';
  }

  reset(): void {
    this.phase = 'idle';
    this.sawWatcher = false;
    this.nextCheckAt = 0;
  }
}
