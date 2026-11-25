import type { PersonState } from './attention';
import { MultiCameraAttention, type OpenCamera } from './multicamera';
import { BlinkScheduler } from './blink';
import type { FaceObservation } from './face';
import { HandScheduler, type HandPose, type HandSettings } from './hand';
import { DreamScheduler, type DreamBubble } from './dreams';
import { CursorGlancer } from './cursor';
import { BreakTimer, BREAK_NUDGE_SECONDS, BREAK_NUDGE_TEXT } from './break';
import { InspirationScheduler, type ActiveInspiration, type InspirationSettings } from './inspirations';
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
  /** Mouth curve: -1 = frown, 0 = flat, 1 = big smile. */
  mouthSmile: number;
  /** How open the mouth is, 0 = closed line, 1 = wide open (laugh or "o"). */
  mouthOpen: number;
  /** Mouth width, relative. 1 = normal. */
  mouthWidth: number;
  /** Mouth opacity, 0..1 (0 when the mouth is turned off). */
  mouthOpacity: number;
  mood: Mood;
  /** Happy message shown while sleeping/bored, or null. */
  inspiration: ActiveInspiration | null;
  /** Tiny alive wobble for the mouth, -1..1. */
  mouthAlive: number;
  hands: HandPose;
  /** A dream bubble floating up while sleeping, or null. */
  dream: DreamBubble | null;
}

/** Target look of each mood. The animator moves toward these values with springs. */
export interface MoodShape {
  /** Mouth curve, opening and width for this mood. */
  mouth: { smile: number; open: number; width: number };
  upperLid: number;
  smile: number;
  lidTilt: number;
  pupilSize: number;
  scale: number;
  browLift: number;
  browTilt: number;
}

export const MOOD_SHAPES: Readonly<Record<Mood, MoodShape>> = {
  sleeping: {
    upperLid: 0.93, smile: 0.05, lidTilt: 0, pupilSize: 0.9, scale: 0.94, browLift: -0.35, browTilt: 0.05,
    mouth: { smile: 0.1, open: 0.12, width: 0.55 },
  },
  surprised: {
    upperLid: 0, smile: 0, lidTilt: 0, pupilSize: 0.72, scale: 1.08, browLift: 1, browTilt: -0.05,
    mouth: { smile: 0, open: 0.75, width: 0.42 },
  },
  curious: {
    upperLid: 0.12, smile: 0, lidTilt: 0, pupilSize: 1, scale: 1, browLift: 0.15, browTilt: 0,
    mouth: { smile: 0.15, open: 0, width: 0.7 },
  },
  happy: {
    upperLid: 0.18, smile: 0.62, lidTilt: -0.06, pupilSize: 1.22, scale: 1.04, browLift: 0.55, browTilt: -0.12,
    mouth: { smile: 0.55, open: 0, width: 0.9 },
  },
  delighted: {
    upperLid: 0.3, smile: 0.95, lidTilt: -0.08, pupilSize: 1.3, scale: 1.07, browLift: 0.75, browTilt: -0.16,
    mouth: { smile: 1, open: 0.55, width: 1.15 },
  },
  bored: {
    upperLid: 0.5, smile: 0.08, lidTilt: 0.16, pupilSize: 0.92, scale: 0.98, browLift: -0.45, browTilt: 0.2,
    mouth: { smile: -0.35, open: 0, width: 0.65 },
  },
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
  /** All cameras, each with its own calibration and timers (see MultiCameraAttention). */
  readonly attention: MultiCameraAttention;
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

  private readonly mouthSmile = new Spring(0.15, 0.32, 0.6);
  private readonly mouthOpen = new Spring(0, 0.22, 0.65);
  private readonly mouthWidth = new Spring(0.7, 0.35, 0.7);
  private readonly mouthAlpha = new Spring(1, 0.4, 1);
  private readonly closeRing = new Spring(0, 0.25, 1);
  private readonly winkSpring = new Spring(0, 0.12, 0.8);
  /** Time the goodbye wink started. */
  private goodbyeAt: number | null = null;

  readonly inspirations: InspirationScheduler;
  readonly hands: HandScheduler;
  readonly dreams: DreamScheduler;
  readonly cursor: CursorGlancer;
  readonly breaks: BreakTimer;
  /** While `now < nudgeUntil` the stretch nudge message is shown. */
  private nudgeUntil = 0;
  private fixation: Vec2 = { x: 0, y: 0 };
  private nextSaccadeAt = 0;
  private captionText = '';
  private readonly startTime: number;
  private lastTime: number | null = null;
  private readonly phase: number;
  private inspirationGlanceUntil = 0;
  private inspirationGaze: Vec2 | null = null;
  /** Time of the last blink we mirrored from the person. */
  private lastMirrorBlinkAt = -Infinity;
  /** When the current yawn started (on falling asleep), or null. */
  private yawnStart: number | null = null;
  /** How long a yawn lasts. */
  private static readonly YAWN_SECONDS = 1.6;
  /** Time since the person was last seen, while they are away. */
  private goneSince: number | null = null;
  /** While `now < welcomeUntil` the eyes show a warm welcome (after a long absence). */
  private welcomeUntil = 0;
  /** An absence this long (s) counts as "you were really gone". */
  private static readonly WELCOME_ABSENCE = 300;
  private static readonly WELCOME_SECONDS = 2.2;

  constructor(settings: Settings = defaultSettings(), seed = 42, now = 0) {
    this.settings = settings;
    this.attention = new MultiCameraAttention(settings.attention, settings.mirrorCamera, settings.calibrations);
    this.moods = new MoodMachine(settings.mood, 'curious', now);
    this.blinks = new BlinkScheduler(seed + 1, now);
    this.rng = new SeededRandom(seed);
    this.inspirations = new InspirationScheduler(settings as InspirationSettings, seed + 2);
    this.hands = new HandScheduler(settings as unknown as HandSettings, seed + 3);
    this.dreams = new DreamScheduler(seed + 4);
    this.cursor = new CursorGlancer(seed + 5);
    this.breaks = new BreakTimer(settings.breakReminderMinutes);
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

  /** Called when the overlay appears: the eyes were hidden while the person was last seen at this time. */
  seedAbsence(goneSince: number | null): void {
    this.goneSince = goneSince;
  }

  /** Carries the break-reminder stretch over from a previous animator (same window clock). */
  seedBreak(state: { presentSince: number | null; fired: boolean }): void {
    this.breaks.seed(state);
  }

  /** The current break-reminder stretch, to seed the next animator with. */
  breakState(): { presentSince: number | null; fired: boolean } {
    return this.breaks.state();
  }

  // ---- System reactions (charging, screenshot, music) ------------------------------------------

  /** A one-shot reaction ends at this time (0 = none). */
  private reactionUntil = 0;
  private reactionKind: 'relieved' | 'squint' | null = null;
  /** Music playing: the eyes bob gently while true. */
  private musicOn = false;

  /**
   * A one-shot reaction to a system event:
   * - 'relieved' (the power was plugged in): a soft smile and a little exhale, ~2.5 s.
   * - 'squint' (a screenshot was taken): the lids close briefly, ~1.2 s.
   */
  react(kind: 'relieved' | 'squint', now: number): void {
    this.reactionKind = kind;
    this.reactionUntil = now + (kind === 'relieved' ? 2.5 : 1.2);
  }

  /** Music turned on or off; while on, the eyes bob gently. */
  setMusic(on: boolean): void {
    this.musicOn = on;
  }

  /** Applies new settings without resetting the animation. */
  apply(settings: Settings): void {
    this.settings = settings;
    this.attention.apply(settings.attention, settings.mirrorCamera, settings.calibrations);
    this.moods.settings = settings.mood;
    this.inspirations.settings = settings as InspirationSettings;
    this.breaks.minutes = settings.breakReminderMinutes;
    this.hands.settings = settings as unknown as HandSettings;
  }

  /** Faces from the cameras. `cameras` = indexes of cameras that sent a frame now (also with no face). */
  ingest(faces: readonly FaceObservation[], time: number, cameras?: readonly number[]): void {
    this.attention.ingest(faces, time, cameras);
  }

  /** Tells the animator which cameras are open (names come from the tracker). */
  setCameras(cameras: readonly OpenCamera[]): void {
    this.attention.setCameras(cameras);
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

    const eligible = mood === 'sleeping' || mood === 'bored';
    const inspiration = this.inspirations.update(now, eligible);

    // Wake-up personality: after a long absence, the return gets a warm welcome.
    if (person.isPresent) {
      if (this.goneSince !== null) {
        if (now - this.goneSince >= EyeAnimator.WELCOME_ABSENCE && mood !== 'sleeping') {
          this.welcomeUntil = now + EyeAnimator.WELCOME_SECONDS;
          this.scaleSpring.velocity += 1.2; // a happy bounce
          this.browLift.velocity += 3;
        }
        this.goneSince = null;
      }
    } else {
      this.goneSince ??= now;
    }
    // The stretch nudge: after a long continuous presence, suggest a break. It takes over the
    // inspiration slot (message, pointing hands, glancing eyes) for its duration, fading in
    // and out like the scheduled messages do.
    if (this.breaks.update(now, person.isPresent)) this.nudgeUntil = now + BREAK_NUDGE_SECONDS;
    const nudgeAge = now - (this.nudgeUntil - BREAK_NUDGE_SECONDS);
    const shownInspiration: ActiveInspiration | null =
      now < this.nudgeUntil
        ? {
            text: BREAK_NUDGE_TEXT,
            position: 'center',
            opacity: clamp(Math.min(nudgeAge / 0.6, (this.nudgeUntil - now) / 0.6), 0, 1),
            colorIndex: 0,
            sizeFactor: 1,
            startTime: this.nudgeUntil - BREAK_NUDGE_SECONDS,
            rtl: false,
          }
        : inspiration;
    const prevInsp = this.pose.inspiration;
    if (shownInspiration && (!prevInsp || shownInspiration.text !== prevInsp.text)) {
      this.startInspirationGlance(shownInspiration, now);
    }

    this.updateFixation(person, mood, now, shownInspiration);

    // When nobody is there, the eyes occasionally glance toward the cursor instead.
    // Never during the goodbye wink: the person just left, and the eyes are saying bye.
    const cursorGlance = this.cursor.update(now, person.isPresent || this.goodbyeAt !== null);

    if (this.inspirationGaze && (now < this.inspirationGlanceUntil || shownInspiration)) {
      const gazeTarget = this.inspirationGaze;
      const tremor = { x: Math.sin(now * 13.1 + this.phase) * 0.006, y: Math.cos(now * 11.3 + this.phase) * 0.006 };
      this.gaze.setTarget(add(gazeTarget, tremor));
    } else {
      if (now >= this.inspirationGlanceUntil) this.inspirationGaze = null;
      const tremor = { x: Math.sin(now * 13.1 + this.phase) * 0.006, y: Math.cos(now * 11.3 + this.phase) * 0.006 };
      this.gaze.setTarget(add(cursorGlance ?? this.fixation, tremor));
    }
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
    // The welcome after a long absence: warm smile and raised brows even without eye contact.
    if (now < this.welcomeUntil && mood !== 'sleeping') {
      this.smile.target = Math.max(this.smile.target, 0.7);
      this.browLift.target = Math.max(this.browLift.target, 0.55);
      this.pupil.target = Math.max(this.pupil.target, 1.25);
    }
    // Mouth: follows the mood. When delighted it mirrors how much the person smiles, with a small "talking" wobble.
    const delighted = mood === 'delighted';
    const mirror = delighted ? clamp(person.smile, 0, 1) : 0;
    this.mouthSmile.target = shape.mouth.smile;
    this.mouthOpen.target = shape.mouth.open * (delighted ? 0.6 + 0.4 * mirror : 1) + (delighted ? Math.sin(now * 7.3) * 0.05 : 0);
    this.mouthWidth.target = shape.mouth.width * (delighted ? 0.9 + 0.15 * mirror : 1);
    this.mouthAlpha.target = this.settings.look.showMouth ? 1 : 0;
    // The welcome smiles with the mouth too (after the mood target, so it is not overwritten).
    if (now < this.welcomeUntil && mood !== 'sleeping') {
      this.mouthSmile.target = Math.max(this.mouthSmile.target, 0.3);
    }
    // System reactions: relieved (charging) raises a soft smile and a little exhale;
    // squint (screenshot) closes the lids briefly; music makes the eyes bob gently.
    if (now < this.reactionUntil && this.reactionKind !== null) {
      const remain = this.reactionUntil - now;
      const total = this.reactionKind === 'relieved' ? 2.5 : 1.2;
      const e = Math.sin((Math.PI * (total - remain)) / total); // 0 -> 1 -> 0
      if (this.reactionKind === 'relieved') {
        this.smile.target = Math.max(this.smile.target, 0.25 + e * 0.35);
        this.browLift.target = Math.max(this.browLift.target, 0.2 + e * 0.2);
        this.scaleSpring.target -= e * 0.02; // a little exhale
      } else {
        this.upperLid.target = Math.max(this.upperLid.target, 0.3 + e * 0.5);
      }
    } else {
      this.reactionKind = null;
    }
    if (this.musicOn) {
      // Bob at ~2.4 Hz (angular frequency: 2.4 * 2π rad/s), gentle.
      this.scaleSpring.target += Math.sin(now * 2.4 * 2 * Math.PI) * 0.012;
      this.smile.target = Math.max(this.smile.target, 0.15);
    }
    // Yawn: as the eyes fall asleep the mouth opens wide once and the lids droop in two stages —
    // droop toward ~0.78 during the yawn, full close only after it ends.
    if (this.yawnStart !== null) {
      const ty = now - this.yawnStart;
      if (ty >= EyeAnimator.YAWN_SECONDS || mood !== 'sleeping') {
        this.yawnStart = null;
      } else {
        const e = Math.sin((Math.PI * ty) / EyeAnimator.YAWN_SECONDS); // 0 → 1 → 0
        this.mouthOpen.target = Math.max(this.mouthOpen.target, e * 0.85);
        const droop = 0.35 + 0.43 * Math.min(1, ty / (EyeAnimator.YAWN_SECONDS * 0.6));
        this.upperLid.target = Math.min(this.upperLid.target, droop);
        this.scaleSpring.target += e * 0.03;
      }
    }
    for (const s of [
      this.upperLid,
      this.smile,
      this.lidTilt,
      this.pupil,
      this.scaleSpring,
      this.convergence,
      this.browLift,
      this.browTilt,
      this.mouthSmile,
      this.mouthOpen,
      this.mouthWidth,
      this.mouthAlpha,
    ]) {
      s.step(dt);
    }

    this.updateLookToClose(person, now, dt);

    // Blinks: slow and rare when bored or sleepy, none while asleep. The user sets rate and speed.
    this.blinks.rate = this.settings.blink.rate;
    this.blinks.speed = this.settings.blink.speed;
    this.blinks.slowness = mood === 'bored' ? 1.7 : mood === 'sleeping' ? 2.5 : 1;
    this.blinks.intervalScale = mood === 'happy' || mood === 'delighted' ? 0.8 : mood === 'bored' ? 1.4 : 1;
    this.blinks.enabled = mood !== 'sleeping';
    // Blink back: mirror the person's blink, at most once per 0.7 s so closed eyes do not cause a flicker.
    if (
      person.isPresent &&
      person.personBlink > 0.45 &&
      mood !== 'sleeping' &&
      this.blinks.enabled &&
      now - this.lastMirrorBlinkAt > 0.7
    ) {
      this.lastMirrorBlinkAt = now;
      this.blinks.trigger(now);
    }
    const blink = this.blinks.closure(now);

    if (this.messageOverride !== null) this.captionText = this.messageOverride;
    this.caption.target = this.messageOverride !== null ? 1 : 0;
    this.caption.step(dt);
    this.sleepBubble.target = mood === 'sleeping' ? 1 : 0;
    this.sleepBubble.step(dt);

    const handPose = this.hands.update(now, mood, shownInspiration, this.settings.showHands);
    const dream = this.dreams.update(now, mood === 'sleeping');
    const mouthAlive =
      Math.sin(now * 1.1 + this.phase) * 0.015 + Math.sin(now * 0.53 + this.phase * 1.3) * 0.008;
    const breathing =
      Math.sin(t * (mood === 'sleeping' ? 1.1 : 1.6) + this.phase) * (mood === 'sleeping' ? 0.018 : 0.008);
    this.pose = this.buildPose(blink, breathing, shownInspiration, mouthAlive, handPose, dream);
    return this.pose;
  }

  private buildPose(
    blink: number,
    breathing = 0,
    inspiration: ActiveInspiration | null = null,
    mouthAlive = 0,
    handPose: HandPose | null = null,
    dream: DreamBubble | null = null,
  ): EyePose {
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
      browLift: this.browLift.value - blink * 0.12,
      browTilt: this.browTilt.value,
      caption: this.captionText,
      captionOpacity: clamp(this.caption.value, 0, 1),
      sleepOpacity: clamp(this.sleepBubble.value, 0, 1),
      closeProgress: clamp(this.closeRing.value, 0, 1),
      wink: clamp(this.winkSpring.value, 0, 1),
      mouthSmile: clamp(this.mouthSmile.value, -1, 1.2),
      mouthOpen: clamp(this.mouthOpen.value, 0, 1),
      mouthWidth: Math.max(this.mouthWidth.value, 0.2),
      mouthOpacity: clamp(this.mouthAlpha.value, 0, 1),
      mood: this.moods.mood,
      inspiration,
      mouthAlive,
      hands: handPose ?? { gesture: 'rest', lift: 0, spread: 0, rotation: 0, opacity: 0, yJitter: 0 },
      dream,
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
      // The longest current eye contact on ONE camera (cameras never add up their time).
      const held = contact ? person.contactSeconds : 0;
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
      case 'delighted':
        this.scaleSpring.velocity += 1.1; // a bigger bounce
        this.browLift.velocity += 4;
        this.mouthWidth.velocity += 2;
        break;
      case 'bored':
      case 'curious':
        if (this.rng.next() < 0.7) this.blinks.trigger(now);
        break;
      case 'sleeping':
        // Falling asleep begins with a yawn.
        this.yawnStart = now;
        break;
    }
    this.nextSaccadeAt = now;
  }

  private startInspirationGlance(insp: ActiveInspiration, now: number): void {
    const targets: Record<string, Vec2> = {
      top: { x: this.rng.range(-0.15, 0.15), y: 0.7 },
      bottom: { x: this.rng.range(-0.15, 0.15), y: -0.6 },
      center: { x: this.rng.range(-0.3, 0.3), y: this.rng.range(-0.1, 0.3) },
    };
    this.inspirationGaze = targets[insp.position] ?? { x: 0, y: 0 };
    this.inspirationGlanceUntil = now + this.rng.range(1.2, 2.5);
  }

  /** Chooses where to look and when to jump to a new point. */
  private updateFixation(person: PersonState, mood: Mood, now: number, _inspiration?: ActiveInspiration | null): void {
    const following = person.isPresent && mood !== 'sleeping' && mood !== 'bored';
    if (following) {
      const target = clampLength(person.position, 1);
      if (now >= this.nextSaccadeAt) {
        // Micro-saccade: a tiny jump around the face. Smaller when making eye contact.
        this.fixation = add(target, scale(this.rng.inUnitDisk(), mood === 'happy' || mood === 'delighted' ? 0.02 : 0.05));
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
    caption: '',
    captionOpacity: 0,
    sleepOpacity: mood === 'sleeping' ? 1 : 0,
    closeProgress: 0,
    wink: 0,
    mouthSmile: s.mouth.smile,
    mouthOpen: s.mouth.open,
    mouthWidth: s.mouth.width,
    mouthOpacity: settings.look.showMouth ? 1 : 0,
    mood,
    inspiration: null,
    mouthAlive: 0,
    hands: { gesture: 'rest', lift: 0, spread: 0, rotation: 0, opacity: 0, yJitter: 0 },
    dream: null,
  };
}
