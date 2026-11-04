import { AttentionEstimator, type PersonState } from './attention';
import { BlinkScheduler } from './blink';
import type { FaceObservation } from './face';
import { add, clamp, clampLength, lerpVec, scale, SeededRandom, type Vec2 } from './math';
import { MoodMachine, type Mood } from './mood';
import { defaultSettings, type Settings } from './settings';
import { Spring, Spring2D } from './spring';

/** Everything the renderer needs to draw one frame. Plain numbers only. */
export interface EyePose {
  /** Where the pupils look, -1..1 per axis (+x right, +y up). */
  gaze: Vec2;
  /** Extra inward turn of the pupils when the person is close, 0..1. */
  convergence: number;
  /** Offset of the eye pair on screen, -1..1 of the free space. */
  drift: Vec2;
  /** Overall scale of the eye pair (breathing, closeness, mood). 1 = normal. */
  scale: number;
  /** Upper lid closure: 0 = wide open, 1 = closed. */
  upperLid: number;
  /** Lower lid raise: 0 = flat, 1 = pushed up into the happy "smile" arch. */
  smile: number;
  /** Upper lid tilt. Positive droops the outer corners (bored/sad). */
  lidTilt: number;
  /** Pupil size, 1 = normal. */
  pupilSize: number;
  /** Eyebrow height: -1 low (frown) .. 1 raised. */
  browLift: number;
  /** Eyebrow tilt. Positive lowers the outer ends. */
  browTilt: number;
  /** Vertical squash during a blink, 0..1. */
  squash: number;
  /** Text under the eyes and its opacity 0..1. */
  caption: string;
  captionOpacity: number;
  /** Opacity 0..1 of the sleeping "z z z". */
  sleepOpacity: number;
  /** Look-to-close progress, 0..1. Drawn as a ring that fills while you hold eye contact. */
  closeProgress: number;
  /** Extra closure of the right eye for a wink, 0..1. */
  wink: number;
  mood: Mood;
}

/** Target look of each mood. The animator moves toward these values with springs. */
export interface MoodShape {
  upperLid: number;
  smile: number;
  lidTilt: number;
  pupilSize: number;
  scale: number;
  browLift: number;
  browTilt: number;
}

export const MOOD_SHAPES: Readonly<Record<Mood, MoodShape>> = {
  sleeping: { upperLid: 0.93, smile: 0.05, lidTilt: 0, pupilSize: 0.9, scale: 0.94, browLift: -0.35, browTilt: 0.05 },
  surprised: { upperLid: 0, smile: 0, lidTilt: 0, pupilSize: 0.72, scale: 1.08, browLift: 1, browTilt: -0.05 },
  curious: { upperLid: 0.12, smile: 0, lidTilt: 0, pupilSize: 1, scale: 1, browLift: 0.15, browTilt: 0 },
  happy: { upperLid: 0.18, smile: 0.62, lidTilt: -0.06, pupilSize: 1.22, scale: 1.04, browLift: 0.55, browTilt: -0.12 },
  bored: { upperLid: 0.5, smile: 0.08, lidTilt: 0.16, pupilSize: 0.92, scale: 0.98, browLift: -0.45, browTilt: 0.2 },
};

/**
 * The "brain" of the eyes. Call `update(now)` once per display frame; it returns the pose to draw.
 *
 * Sources of life:
 * - springs on every value, so changes ease in and out with a little overshoot;
 * - saccades (quick gaze jumps, then a short rest) and micro-saccades around the target;
 * - a small tremor, slow breathing (scale) and floating (position);
 * - natural random blinks, plus a blink on most mood changes;
 * - smiling back more when the person smiles.
 */
export class EyeAnimator {
  settings: Settings;
  readonly attention: AttentionEstimator;
  readonly moods: MoodMachine;
  pose: EyePose;
  /** When set, this text replaces the mood caption (used during calibration). */
  messageOverride: string | null = null;
  /** Set to true once, when look-to-close finished. The page then asks the app to hide the eyes. */
  wantsToClose = false;
  /** Disables look-to-close for a while (for example during calibration). */
  lookToCloseSuspended = false;

  private readonly blinks: BlinkScheduler;
  private readonly rng: SeededRandom;
  private readonly gaze = new Spring2D({ x: 0, y: 0 }, 0.09, 0.82);
  private readonly drift = new Spring2D({ x: 0, y: 0 }, 1.6, 0.9);
  private readonly upperLid = new Spring(0.12, 0.35, 0.85);
  private readonly smile = new Spring(0, 0.4, 0.7);
  private readonly lidTilt = new Spring(0, 0.5, 0.9);
  private readonly pupil = new Spring(1, 0.6, 0.8);
  private readonly scaleSpring = new Spring(1, 0.45, 0.6);
  private readonly caption = new Spring(0, 0.5, 1);
  private readonly sleepBubble = new Spring(0, 1.2, 1);
  private readonly convergence = new Spring(0, 0.8, 1);
  private readonly browLift = new Spring(0, 0.4, 0.65);
  private readonly browTilt = new Spring(0, 0.5, 0.85);

  private readonly closeRing = new Spring(0, 0.25, 1);
  private readonly winkSpring = new Spring(0, 0.12, 0.8);
  /** Time eye contact started, for look-to-close. */
  private contactStart: number | null = null;
  /** Time the goodbye wink started. */
  private goodbyeAt: number | null = null;

  private fixation: Vec2 = { x: 0, y: 0 };
  private nextSaccadeAt = 0;
  private captionText = '';
  private readonly startTime: number;
  private lastTime: number | null = null;
  private readonly phase: number;

  constructor(settings: Settings = defaultSettings(), seed = 42, now = 0) {
    this.settings = settings;
    this.attention = new AttentionEstimator(settings.attention, settings.mirrorCamera);
    this.moods = new MoodMachine(settings.mood, 'curious', now);
    this.blinks = new BlinkScheduler(seed + 1, now);
    this.rng = new SeededRandom(seed);
    this.startTime = now;
    this.phase = this.rng.range(0, Math.PI * 2);
    this.pose = this.buildPose(0);
  }

  get mood(): Mood {
    return this.moods.mood;
  }

  get person(): PersonState {
    return this.attention.state;
  }

  /** Applies new settings without resetting the animation. */
  apply(settings: Settings): void {
    this.settings = settings;
    this.attention.settings = settings.attention;
    this.attention.mirror = settings.mirrorCamera;
    this.moods.settings = settings.mood;
  }

  ingest(faces: readonly FaceObservation[], time: number): void {
    this.attention.ingest(faces, time);
  }

  /** Called when the overlay appears: the eyes open from closed with a blink. */
  wakeUp(now: number): void {
    this.upperLid.value = 1;
    this.blinks.trigger(now);
    this.nextSaccadeAt = now;
  }

  update(now: number): EyePose {
    const dt = clamp(this.lastTime === null ? 1 / 60 : now - this.lastTime, 0, 0.1);
    this.lastTime = now;

    this.attention.tick(now);
    const person = this.attention.state;
    const changed = this.moods.update(person, now);
    if (changed) this.onMoodChange(changed, now);
    const mood = this.moods.mood;
    const shape = MOOD_SHAPES[mood];

    this.updateFixation(person, mood, now);

    const tremor = { x: Math.sin(now * 13.1 + this.phase) * 0.006, y: Math.cos(now * 11.3 + this.phase) * 0.006 };
    this.gaze.setTarget(add(this.fixation, tremor));
    this.gaze.step(dt);

    // The eye pair floats, and leans toward the person so it stays in front of them.
    const t = now - this.startTime;
    let driftTarget: Vec2 = {
      x: Math.sin(t * 0.21 + this.phase) * 0.04,
      y: Math.sin(t * 0.17 + this.phase * 1.7) * 0.03,
    };
    if (person.isPresent && mood !== 'sleeping') {
      driftTarget = add(driftTarget, scale(person.position, mood === 'bored' ? 0.12 : 0.32));
    }
    this.drift.setTarget(driftTarget);
    this.drift.step(dt);

    // Smile back: if the person smiles while making eye contact, the eyes smile more.
    const smileBack = mood === 'happy' ? clamp(person.smile, 0, 1) * 0.3 : 0;
    this.upperLid.target = shape.upperLid + smileBack * 0.25;
    this.smile.target = shape.smile + smileBack;
    this.lidTilt.target = shape.lidTilt;
    const interest = person.isPresent ? 1 + clamp(person.size - 0.25, -0.1, 0.15) : 1;
    this.pupil.target = shape.pupilSize * interest;
    const closeness = person.isPresent ? clamp((person.size - 0.25) * 0.25, -0.03, 0.06) : 0;
    this.scaleSpring.target = shape.scale + closeness;
    this.convergence.target = person.isPresent ? clamp((person.size - 0.2) * 2, 0, 1) : 0;
    this.browLift.target = shape.browLift;
    this.browTilt.target = shape.browTilt;
    for (const s of [
      this.upperLid,
      this.smile,
      this.lidTilt,
      this.pupil,
      this.scaleSpring,
      this.convergence,
      this.browLift,
      this.browTilt,
    ]) {
      s.step(dt);
    }

    this.updateLookToClose(person, now, dt);

    // Blinks: slow and rare when bored or sleepy, none while asleep. The user sets rate and speed.
    this.blinks.rate = this.settings.blink.rate;
    this.blinks.speed = this.settings.blink.speed;
    this.blinks.slowness = mood === 'bored' ? 1.7 : mood === 'sleeping' ? 2.5 : 1;
    this.blinks.intervalScale = mood === 'happy' ? 0.8 : mood === 'bored' ? 1.4 : 1;
    this.blinks.enabled = mood !== 'sleeping';
    const blink = this.blinks.closure(now);

    if (mood === 'happy') this.captionText = this.settings.welcomeText;
    else if (mood === 'bored') this.captionText = this.settings.boredText;
    if (this.messageOverride !== null) this.captionText = this.messageOverride;
    const captionWanted =
      this.messageOverride !== null || (this.settings.showCaptions && (mood === 'happy' || mood === 'bored'));
    this.caption.target = captionWanted ? 1 : 0;
    this.caption.step(dt);
    this.sleepBubble.target = mood === 'sleeping' ? 1 : 0;
    this.sleepBubble.step(dt);

    const breathing =
      Math.sin(t * (mood === 'sleeping' ? 1.1 : 1.6) + this.phase) * (mood === 'sleeping' ? 0.018 : 0.008);
    this.pose = this.buildPose(blink, breathing);
    return this.pose;
  }

  private buildPose(blink: number, breathing = 0): EyePose {
    const lid = clamp(this.upperLid.value, 0, 1);
    return {
      gaze: this.gaze.value,
      convergence: this.convergence.value,
      drift: this.drift.value,
      scale: this.scaleSpring.value + breathing,
      upperLid: lid + (1 - lid) * blink,
      squash: blink * 0.08,
      smile: clamp(this.smile.value, 0, 1),
      lidTilt: this.lidTilt.value,
      pupilSize: Math.max(this.pupil.value, 0.3),
      // Brows dip a little during a blink, like real faces.
      browLift: this.browLift.value - blink * 0.12,
      browTilt: this.browTilt.value,
      caption: this.captionText,
      captionOpacity: clamp(this.caption.value, 0, 1),
      sleepOpacity: clamp(this.sleepBubble.value, 0, 1),
      closeProgress: clamp(this.closeRing.value, 0, 1),
      wink: clamp(this.winkSpring.value, 0, 1),
      mood: this.moods.mood,
    };
  }

  /**
   * Look-to-close: holding eye contact for `lookToCloseSeconds` makes the eyes wink goodbye and close.
   * A ring shows the progress. Looking away resets it.
   */
  private updateLookToClose(person: PersonState, now: number, dt: number): void {
    const enabled = this.settings.lookToClose && !this.lookToCloseSuspended && this.messageOverride === null;
    const contact = enabled && person.isPresent && person.isMakingEyeContact;
    if (this.goodbyeAt === null) {
      if (contact) this.contactStart ??= now;
      else this.contactStart = null;
      const held = this.contactStart === null ? 0 : now - this.contactStart;
      // Show the ring only after a short moment, so normal glances do not show it.
      const delay = 0.4;
      const span = Math.max(this.settings.lookToCloseSeconds - delay, 0.1);
      this.closeRing.target = held > delay ? Math.min((held - delay) / span, 1) : 0;
      if (contact && held >= this.settings.lookToCloseSeconds) {
        this.goodbyeAt = now;
        this.closeRing.value = 1;
      }
    } else {
      // Goodbye: wink, then ask to close.
      const t = now - this.goodbyeAt;
      this.winkSpring.target = t < 0.35 ? 1 : 0;
      this.closeRing.target = 0;
      if (t >= 0.6 && !this.wantsToClose) this.wantsToClose = true;
    }
    this.closeRing.step(dt);
    this.winkSpring.step(dt);
  }

  private onMoodChange(mood: Mood, now: number): void {
    switch (mood) {
      case 'surprised':
        this.scaleSpring.velocity += 0.9; // a small "pop"
        this.blinks.trigger(now);
        break;
      case 'happy':
        this.scaleSpring.velocity += 0.6; // a small bounce of joy
        this.browLift.velocity += 3;
        break;
      case 'bored':
      case 'curious':
        if (this.rng.next() < 0.7) this.blinks.trigger(now);
        break;
      case 'sleeping':
        break;
    }
    this.nextSaccadeAt = now;
  }

  /** Chooses where to look and when to jump to a new point. */
  private updateFixation(person: PersonState, mood: Mood, now: number): void {
    const following = person.isPresent && mood !== 'sleeping' && mood !== 'bored';
    if (following) {
      const target = clampLength(person.position, 1);
      if (now >= this.nextSaccadeAt) {
        // Micro-saccade: a tiny jump around the face. Smaller when making eye contact.
        this.fixation = add(target, scale(this.rng.inUnitDisk(), mood === 'happy' ? 0.02 : 0.05));
        this.nextSaccadeAt = now + this.rng.range(0.35, 1.1);
      } else {
        // Smooth pursuit: follow head movement between micro-saccades.
        this.fixation = lerpVec(this.fixation, target, 0.25);
      }
      return;
    }
    if (now < this.nextSaccadeAt) return;
    if (mood === 'sleeping') {
      this.fixation = { x: 0, y: -0.35 };
      this.nextSaccadeAt = now + 3;
      return;
    }
    if (mood === 'bored') {
      // Look anywhere except at the person: to the side, at the ceiling, or down.
      const side = person.position.x > 0 ? -1 : 1;
      const choices: Vec2[] = [
        { x: side * 0.85, y: 0.55 },
        { x: side * 0.9, y: -0.15 },
        { x: -side * 0.4, y: 0.8 },
        { x: side * 0.3, y: -0.7 },
      ];
      this.fixation = add(this.rng.pick(choices), scale(this.rng.inUnitDisk(), 0.08));
      this.nextSaccadeAt = now + this.rng.range(1.4, 3.2);
      // Sometimes a quick glance back at the person, then away again.
      if (person.isPresent && this.rng.next() < 0.25) {
        this.fixation = person.position;
        this.nextSaccadeAt = now + 0.5;
      }
      return;
    }
    // Nobody there: look around the room, resting on each point.
    this.fixation = scale(this.rng.inUnitDisk(), 0.8);
    this.nextSaccadeAt = now + this.rng.range(0.8, 2.4);
  }
}


/** A resting pose for a mood, without any animation. Used for previews and snapshots. */
export function staticPose(mood: Mood, settings: Settings = defaultSettings()): EyePose {
  const s = MOOD_SHAPES[mood];
  return {
    gaze: mood === 'bored' ? { x: 0.75, y: 0.4 } : mood === 'sleeping' ? { x: 0, y: -0.35 } : { x: 0.15, y: 0.05 },
    convergence: 0.2,
    drift: { x: 0, y: 0 },
    scale: s.scale,
    upperLid: s.upperLid,
    smile: s.smile,
    lidTilt: s.lidTilt,
    pupilSize: s.pupilSize,
    browLift: s.browLift,
    browTilt: s.browTilt,
    squash: 0,
    caption: mood === 'happy' ? settings.welcomeText : mood === 'bored' ? settings.boredText : '',
    captionOpacity: mood === 'happy' || mood === 'bored' ? 1 : 0,
    sleepOpacity: mood === 'sleeping' ? 1 : 0,
    closeProgress: 0,
    wink: 0,
    mood,
  };
}
