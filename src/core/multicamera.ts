import { ABSENT, AttentionEstimator, type PersonState } from './attention';
import type { FaceObservation } from './face';
import type { Vec2 } from './math';
import { isBuiltInCamera } from './camera';
import { defaultSettings, findCalibration, type AttentionSettings, type CameraCalibration } from './settings';

/** A camera that is open now: its index in the tracker (0, 1, ...) and its name and id. */
export interface OpenCamera {
  index: number;
  label: string;
  id: string;
}

/**
 * Several cameras, each working on its own.
 *
 * Every camera has its own `AttentionEstimator` with its own calibration, eye contact, smile and timers.
 * The cameras are combined like this ("the first camera to see it wins"):
 * - present: any camera sees a face;
 * - eye contact: any camera has eye contact; `contactSeconds` is the longest current run on ONE camera;
 * - smile with eye contact: the SAME camera must see both; `smileContactSeconds` is the longest such run;
 * - nobody looking: no camera has eye contact.
 * Counts of different cameras are never added: if camera A counted 3 s and you turn to camera B, B starts at 0.
 *
 * Calibration: a camera with its own calibration uses it. Without one, it uses the default values when it is the
 * only camera; when there are several cameras it counts for presence only, so a side camera cannot mistake
 * "looking at this camera" for "looking at the eyes".
 */
export class MultiCameraAttention {
  private readonly estimators = new Map<number, AttentionEstimator>();
  private cameras: OpenCamera[] = [];
  /** The camera the eyes follow now. */
  private followed: number | null = null;
  state: PersonState = { ...ABSENT };

  constructor(
    private settings: AttentionSettings,
    private mirror: boolean,
    private calibrations: readonly CameraCalibration[] = [],
  ) {}

  /** Applies new settings and calibrations to all cameras. */
  apply(settings: AttentionSettings, mirror: boolean, calibrations: readonly CameraCalibration[]): void {
    this.settings = settings;
    this.mirror = mirror;
    this.calibrations = calibrations;
    for (const [index, e] of this.estimators) this.configure(e, index);
  }

  /** Tells which cameras are open (names come from the tracker). */
  setCameras(cameras: readonly OpenCamera[]): void {
    this.cameras = [...cameras];
    for (const [index, e] of this.estimators) this.configure(e, index);
  }

  /**
   * The calibration of one camera, or null when it was never calibrated.
   * Settings from before per-camera calibration had one calibration (`attention.reference`, if the user changed it
   * from the default). It was made with the built-in camera, so the built-in camera uses it until it is calibrated.
   */
  calibrationOf(index: number): CameraCalibration | null {
    const cam = this.cameras.find((c) => c.index === index);
    if (!cam) return null;
    const own = findCalibration(this.calibrations, cam);
    if (own) return own;
    const legacy = this.settings.reference;
    const isDefault = JSON.stringify(legacy) === JSON.stringify(defaultSettings().attention.reference);
    if (!isDefault && isBuiltInCamera(cam.label)) {
      return { label: cam.label, id: cam.id, reference: legacy, faceCenter: { x: 0.5, y: 0.5 }, date: '' };
    }
    return null;
  }

  /** The estimator of one camera (created on first use). */
  camera(index: number): AttentionEstimator {
    let e = this.estimators.get(index);
    if (!e) {
      e = new AttentionEstimator(this.settings, this.mirror);
      this.configure(e, index);
      this.estimators.set(index, e);
    }
    return e;
  }

  /** Camera indexes that have an estimator (that sent at least one frame). */
  indexes(): number[] {
    return [...this.estimators.keys()].sort((a, b) => a - b);
  }

  private configure(e: AttentionEstimator, index: number): void {
    const calibration = this.calibrationOf(index);
    e.settings = calibration ? { ...this.settings, reference: calibration.reference } : this.settings;
    e.mirror = this.mirror;
    // Several cameras: an uncalibrated one may only report presence.
    e.contactAllowed = calibration !== null || this.cameras.length <= 1;
  }

  /**
   * Feeds the latest faces from all cameras. Faces carry their camera index; each camera's faces go to its own
   * estimator. `cameras` lists the camera indexes that sent a frame now (also when they saw nobody).
   */
  ingest(faces: readonly FaceObservation[], time: number, cameras?: readonly number[]): void {
    const byCamera = new Map<number, FaceObservation[]>();
    for (const index of cameras ?? []) byCamera.set(index, []);
    for (const f of faces) {
      const index = f.camera ?? 0;
      if (!byCamera.has(index)) byCamera.set(index, []);
      byCamera.get(index)!.push(f);
    }
    if (byCamera.size === 0) byCamera.set(0, []);
    for (const [index, list] of byCamera) this.camera(index).ingest(list, time);
    this.combine();
  }

  tick(now: number): void {
    for (const e of this.estimators.values()) e.tick(now);
    this.combine();
  }

  /** Builds the combined state: "the first camera to see it wins". */
  private combine(): void {
    const states = [...this.estimators.entries()].map(([index, e]) => ({ index, s: e.state }));
    const present = states.filter((x) => x.s.isPresent);
    if (!present.length) {
      this.state = { ...ABSENT };
      this.followed = null;
      return;
    }
    const best = <T>(list: T[], key: (x: T) => number): T => list.reduce((a, b) => (key(b) > key(a) ? b : a));
    const contact = present.filter((x) => x.s.isMakingEyeContact);
    // Follow the camera with eye contact; else stay with the one we followed; else the one with the biggest face.
    const follow =
      (contact.length ? best(contact, (x) => x.s.contactSeconds) : undefined) ??
      present.find((x) => x.index === this.followed) ??
      best(present, (x) => x.s.size);
    this.followed = follow.index;
    const smiler = best(present, (x) => (x.s.isSmiling ? 1 + x.s.smile : x.s.smile));
    this.state = {
      isPresent: true,
      position: this.alignedPosition(follow.index, follow.s.position),
      size: follow.s.size,
      contactScore: Math.max(...present.map((x) => x.s.contactScore)),
      isMakingEyeContact: contact.length > 0,
      smile: smiler.s.smile,
      isSmiling: present.some((x) => x.s.isSmiling),
      contactSeconds: Math.max(0, ...present.map((x) => x.s.contactSeconds)),
      smileContactSeconds: Math.max(0, ...present.map((x) => x.s.smileContactSeconds)),
      lastSeen: Math.max(...present.map((x) => x.s.lastSeen ?? 0)),
    };
  }

  /**
   * The eyes look at the person. Each camera sees the face somewhere else in its picture; the calibration stores
   * where the face was while looking at the eyes. Moving that spot to the center means: when you look at the eyes,
   * they look straight back, whichever camera they follow. This keeps a switch between cameras smooth.
   */
  private alignedPosition(index: number, position: Vec2): Vec2 {
    const c = this.calibrationOf(index);
    if (!c || this.cameras.length <= 1) return position;
    const centerX = (0.5 - c.faceCenter.x) * 2 * (this.mirror ? -1 : 1);
    const centerY = (0.5 - c.faceCenter.y) * 2;
    const clampUnit = (v: number): number => Math.max(-1, Math.min(1, v));
    return { x: clampUnit(position.x - centerX), y: clampUnit(position.y - centerY) };
  }

  /** The newest raw face of one camera, for calibration. */
  lastObservation(index: number): FaceObservation | null {
    return this.estimators.get(index)?.lastObservation ?? null;
  }
}
