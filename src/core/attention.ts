import type { FaceObservation } from './face';
import { clamp, isFiniteVec, length, lerp, lerpVec, smoothingFactor, smoothstep, sub, type Vec2 } from './math';
import { defaultSettings, type AttentionSettings, type GazeReference } from './settings';

/** What the eyes know about the person in front of the screen. */
export interface PersonState {
  isPresent: boolean;
  /** Position as seen from the screen, -1..1. +x = screen right, +y = up. Already mirrored. */
  position: Vec2;
  /** Face width as a fraction of the camera image. Bigger = closer. */
  size: number;
  /** Smoothed eye contact score, 0 (looking away) .. 1 (looking at the eyes). */
  contactScore: number;
  /** Eye contact decision with hysteresis, so it does not flicker. */
  isMakingEyeContact: boolean;
  /** Smoothed smile of the person, 0..1. */
  smile: number;
  /** Smile decision with hysteresis: the person is smiling now. */
  isSmiling: boolean;
  /** True when the main camera sees the person. False when only an extra camera does. */
  seenByMainCamera: boolean;
  /** Time (s) of the last face detection. */
  lastSeen: number | null;
}

export const ABSENT: Readonly<PersonState> = Object.freeze({
  isPresent: false,
  position: { x: 0, y: 0 },
  size: 0,
  contactScore: 0,
  isMakingEyeContact: false,
  smile: 0,
  isSmiling: false,
  seenByMainCamera: false,
  lastSeen: null,
});

/** Smile score needed to count as smiling, and the score below which it stops. */
export const SMILE_ON = 0.45;
export const SMILE_OFF = 0.25;

/** Contact score needed to turn eye contact on, and the score below which it turns off. */
export const CONTACT_ON = 0.62;
export const CONTACT_OFF = 0.38;
const MIN_CONFIDENCE = 0.5;

/**
 * Turns raw face detections into a stable `PersonState`.
 *
 * Raw detections are noisy: faces drop out for a frame, eye points jump. This class smooths
 * positions, uses a grace period for short gaps, and uses hysteresis for the eye contact decision.
 */
export class AttentionEstimator {
  settings: AttentionSettings;
  mirror: boolean;
  state: PersonState = { ...ABSENT };
  /** Most recent raw observation of the tracked face. Used for calibration and debug display. */
  lastObservation: FaceObservation | null = null;
  private lastUpdate: number | null = null;

  constructor(settings: AttentionSettings = defaultSettings().attention, mirror = false) {
    this.settings = settings;
    this.mirror = mirror;
  }

  /** Instant (unsmoothed) eye contact score for one observation, 0..1. */
  rawContactScore(face: FaceObservation): number {
    const s = this.settings;
    const ref = s.reference;
    const dYaw = (face.yaw - ref.yaw) / Math.max(s.yawTolerance, 0.1);
    const dPitch = (face.pitch - ref.pitch) / Math.max(s.pitchTolerance, 0.1);
    let squared = dYaw * dYaw + dPitch * dPitch;
    if (face.gaze) {
      const d = (length(sub(face.gaze, ref.gaze)) / Math.max(s.gazeTolerance, 0.01)) * s.gazeWeight;
      squared += d * d;
    }
    // Deviation 1.0 = at the edge of the tolerance. The score falls from 1 to 0 around that edge.
    return 1 - smoothstep(0.75, 1.35, Math.sqrt(squared));
  }

  /** Maps a face center in camera coordinates to a position as seen from the screen. */
  screenPosition(face: FaceObservation): Vec2 {
    // The camera looks at the person, so the raw image is a mirror of what the screen "sees".
    const x = (0.5 - face.center.x) * 2 * (this.mirror ? -1 : 1);
    const y = (0.5 - face.center.y) * 2; // image y grows down, screen y grows up
    return { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  /** Picks the face to follow: the closest (biggest), with a bonus for staying near the current one. */
  chooseFace(faces: readonly FaceObservation[]): FaceObservation | null {
    const usable = faces.filter((f) => f.confidence >= MIN_CONFIDENCE && isFiniteVec(f.center) && f.size > 0);
    let best: FaceObservation | null = null;
    let bestScore = -Infinity;
    for (const face of usable) {
      let score = face.size;
      if (this.state.isPresent) {
        const distance = length(sub(this.screenPosition(face), this.state.position));
        score = face.size * (1.5 - Math.min(distance, 1));
      }
      if (score > bestScore) {
        best = face;
        bestScore = score;
      }
    }
    return best;
  }

  /**
   * Feeds the latest detections. Faces may come from several cameras (`face.camera`, 0 = main camera).
   *
   * - The main camera decides where the person is and whether they make eye contact: it is the camera
   *   next to the eyes, so "looking at the camera" means "looking at the eyes".
   * - Extra cameras look from other angles. A face there keeps the person present (and lets smiles count),
   *   but eye contact fades, because from the side every face looks turned away.
   */
  ingest(faces: readonly FaceObservation[], time: number): void {
    const dt = this.lastUpdate === null ? 0 : time - this.lastUpdate;
    this.lastUpdate = time;
    const main = faces.filter((f) => (f.camera ?? 0) === 0);
    const face = this.chooseFace(main);
    const other = face ? null : this.biggest(faces.filter((f) => (f.camera ?? 0) !== 0));
    const st = this.state;
    if (!face && !other) {
      this.decay(dt, time);
      return;
    }
    if (face) {
      this.lastObservation = face;
      const position = this.screenPosition(face);
      const raw = this.rawContactScore(face);
      if (st.isPresent && st.seenByMainCamera) {
        const k = smoothingFactor(dt, this.settings.positionSmoothing);
        st.position = lerpVec(st.position, position, k);
        st.size = lerp(st.size, face.size, k);
        st.contactScore = lerp(st.contactScore, raw, smoothingFactor(dt, this.settings.contactSmoothing));
      } else {
        // New person for the main camera: jump to their position, build up eye contact from half.
        st.position = position;
        st.size = face.size;
        st.contactScore = st.isPresent ? lerp(st.contactScore, raw, 0.5) : raw * 0.5;
      }
      st.seenByMainCamera = true;
    } else {
      // Only an extra camera sees someone: keep the position, let eye contact fade.
      if (!st.isPresent) {
        st.position = { x: 0, y: 0 };
        st.size = other!.size;
      }
      st.contactScore = lerp(st.contactScore, 0, smoothingFactor(dt, this.settings.contactSmoothing * 2));
      st.seenByMainCamera = false;
    }
    const smile = (face ?? other)!.smile;
    st.smile = st.isPresent ? lerp(st.smile, smile, smoothingFactor(dt, 0.2)) : smile;
    st.isPresent = true;
    st.lastSeen = time;
    this.updateContactDecision();
    this.updateSmileDecision();
  }

  private biggest(faces: readonly FaceObservation[]): FaceObservation | null {
    const usable = faces.filter((f) => f.confidence >= MIN_CONFIDENCE && f.size > 0);
    return usable.reduce<FaceObservation | null>((best, f) => (!best || f.size > best.size ? f : best), null);
  }

  private updateSmileDecision(): void {
    const st = this.state;
    if (st.isSmiling) {
      if (st.smile < SMILE_OFF) st.isSmiling = false;
    } else if (st.smile > SMILE_ON) {
      st.isSmiling = true;
    }
  }

  /** Call regularly, so absence is detected even when no camera frames arrive. */
  tick(now: number): void {
    const seen = this.state.lastSeen;
    if (this.state.isPresent && seen !== null && now - seen > this.settings.absenceGrace) {
      this.state = { ...ABSENT };
    }
  }

  private decay(dt: number, now: number): void {
    if (!this.state.isPresent) return;
    // Keep the last position during the grace period, but let eye contact fade.
    const k = smoothingFactor(dt, this.settings.contactSmoothing * 2);
    this.state.contactScore = lerp(this.state.contactScore, 0, k);
    this.state.smile = lerp(this.state.smile, 0, k);
    this.updateContactDecision();
    this.updateSmileDecision();
    this.tick(now);
  }

  private updateContactDecision(): void {
    const st = this.state;
    if (st.isMakingEyeContact) {
      if (st.contactScore < CONTACT_OFF) st.isMakingEyeContact = false;
    } else if (st.contactScore > CONTACT_ON) {
      st.isMakingEyeContact = true;
    }
  }

  /** A reference from the current observation: "the way you look now is looking at the eyes". */
  calibrationSample(): GazeReference | null {
    const face = this.lastObservation;
    if (!face || !this.state.isPresent) return null;
    return { yaw: face.yaw, pitch: face.pitch, gaze: face.gaze ?? this.settings.reference.gaze };
  }
}

/** Average of calibration samples. `null` if there are none. */
export function averageReference(samples: readonly GazeReference[]): GazeReference | null {
  if (samples.length === 0) return null;
  const n = samples.length;
  const sum = samples.reduce(
    (acc, s) => ({ yaw: acc.yaw + s.yaw, pitch: acc.pitch + s.pitch, gx: acc.gx + s.gaze.x, gy: acc.gy + s.gaze.y }),
    { yaw: 0, pitch: 0, gx: 0, gy: 0 },
  );
  return { yaw: sum.yaw / n, pitch: sum.pitch / n, gaze: { x: sum.gx / n, y: sum.gy / n } };
}
