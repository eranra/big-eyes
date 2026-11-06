/**
 * "Is someone looking at the screen?" check that runs while the eyes are hidden.
 *
 * When the idle time is reached, the app does not show the eyes at once. It first opens the camera for
 * a short check. If a person is looking at the screen, the eyes wait, and the app checks again later.
 *
 * "Looking at the screen" uses exactly the same process as eye contact (and look-to-close): every camera works
 * on its own, with its own calibration, and compares head angles and eye direction with its reference. If ANY
 * camera sees eye contact, someone is looking. So looking at a phone, a book, or another screen does not count.
 */
import { MultiCameraAttention, type OpenCamera } from './multicamera';
import type { FaceObservation } from './face';
import type { AttentionSettings, CameraCalibration } from './settings';

export interface PresenceTiming {
  /** How long one camera check looks at frames (seconds), counted after the warm-up. */
  checkSeconds: number;
  /** If the camera sends no frame for this long (seconds), give up the check and show the eyes. */
  startTimeoutSeconds: number;
  /**
   * Frames in the first seconds after the camera turns on are often dark while the camera adjusts its exposure.
   * Eye contact in them still counts, but "nobody looking" is only decided after this warm-up plus `checkSeconds`.
   */
  warmupSeconds: number;
  /** After a check that saw someone looking, wait this long before checking again (seconds). */
  recheckSeconds: number;
}

export const DEFAULT_PRESENCE_TIMING: PresenceTiming = { checkSeconds: 3, startTimeoutSeconds: 15, warmupSeconds: 1, recheckSeconds: 15 };

export type PresencePhase = 'idle' | 'checking' | 'watched';

/**
 * Small state machine for the presence check.
 *
 * - `start(now, attention, mirror)` starts a check (the camera opens), with the current eye contact settings.
 * - `report(faces, now)` gives the faces of each camera frame.
 * - `result(now)` returns 'watched' (someone looks at the screen: wait), 'nobody' (show the eyes), or null.
 * - `reset()` when the user uses the keyboard or mouse again.
 */
export class PresenceCheck {
  phase: PresencePhase = 'idle';
  private startedAt = 0;
  private firstFrameAt: number | null = null;
  private sawWatcher = false;
  private nextCheckAt = 0;
  /** Fresh eye contact estimators (one per camera) for each check, so an old score never carries over. */
  private estimator: MultiCameraAttention | null = null;

  constructor(readonly timing: PresenceTiming = DEFAULT_PRESENCE_TIMING) {}

  /** True when a camera check should run now. */
  due(now: number): boolean {
    return this.phase !== 'checking' && now >= this.nextCheckAt;
  }

  start(
    now: number,
    attention: AttentionSettings,
    mirror = false,
    calibrations: readonly CameraCalibration[] = [],
    cameras: readonly OpenCamera[] = [],
  ): void {
    this.phase = 'checking';
    this.startedAt = now;
    this.firstFrameAt = null;
    this.sawWatcher = false;
    this.estimator = new MultiCameraAttention(attention, mirror, calibrations);
    this.estimator.setCameras(cameras);
  }

  /** Updates the list of open cameras during a check (their names arrive when they open). */
  setCameras(cameras: readonly OpenCamera[]): void {
    this.estimator?.setCameras(cameras);
  }

  /** Faces from one camera frame (an empty list is a frame with nobody in it). */
  report(faces: readonly FaceObservation[], now: number, cameras?: readonly number[]): void {
    if (this.phase !== 'checking' || !this.estimator) return;
    this.firstFrameAt ??= now;
    this.estimator.ingest(faces, now, cameras);
    if (this.estimator.state.isMakingEyeContact) this.sawWatcher = true;
  }

  /** Ends the check early when someone looks at the screen, or after warm-up plus `checkSeconds`. */
  result(now: number): 'watched' | 'nobody' | null {
    if (this.phase !== 'checking') return null;
    if (this.sawWatcher) {
      this.phase = 'watched';
      this.nextCheckAt = now + this.timing.recheckSeconds;
      this.estimator = null;
      return 'watched';
    }
    const looked = this.firstFrameAt !== null && now - this.firstFrameAt >= this.timing.warmupSeconds + this.timing.checkSeconds;
    const cameraSilent = this.firstFrameAt === null && now - this.startedAt >= this.timing.startTimeoutSeconds;
    if (looked || cameraSilent) {
      this.phase = 'idle';
      this.estimator = null;
      return 'nobody';
    }
    return null;
  }

  /** The camera could not be used: do not block the eyes because of it. */
  fail(): void {
    this.phase = 'idle';
    this.estimator = null;
  }

  reset(): void {
    this.phase = 'idle';
    this.sawWatcher = false;
    this.nextCheckAt = 0;
    this.estimator = null;
  }
}
