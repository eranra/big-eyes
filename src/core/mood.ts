import type { PersonState } from './attention';
import { defaultSettings, type MoodSettings } from './settings';

/** The emotional state of the eyes. */
export type Mood =
  /** Nobody there for a while. Eyes almost closed, slow breathing. */
  | 'sleeping'
  /** Someone just appeared. Eyes open wide for a moment. */
  | 'surprised'
  /** Someone is there. Eyes follow them with interest. */
  | 'curious'
  /** The person looks back at the eyes. Eyes smile and say "Welcome". */
  | 'happy'
  /** The person smiles at the eyes. The eyes smile back with a big smile and a mouth. */
  | 'delighted'
  /** The person looks away for a while. Heavy lids, eyes look away, "Bored". */
  | 'bored';

export const MOODS: readonly Mood[] = ['sleeping', 'surprised', 'curious', 'happy', 'delighted', 'bored'];

/**
 * Decides the mood from the person state over time.
 *
 * Mood changes use dwell times, so a short glance or a missed camera frame does not cause flicker.
 */
export class MoodMachine {
  settings: MoodSettings;
  mood: Mood;
  /** Time (s) the current mood started. */
  moodStart: number;
  private noContactSince: number | null;
  private absentSince: number | null;
  private wasPresent = false;
  private noSmileSince: number | null = null;

  constructor(settings: MoodSettings = defaultSettings().mood, initial: Mood = 'curious', now = 0) {
    this.settings = settings;
    this.mood = initial;
    this.moodStart = now;
    this.absentSince = now;
    this.noContactSince = now;
  }

  timeInMood(now: number): number {
    return now - this.moodStart;
  }

  /** Updates the mood. Returns the new mood if it changed, otherwise `null`. */
  update(person: PersonState, now: number): Mood | null {
    if (person.isPresent) this.absentSince = null;
    else this.absentSince ??= now;

    // Durations come from the cameras' own timers (one camera's run, never added across cameras).
    if (person.isPresent && person.isMakingEyeContact) {
      this.noContactSince = null;
    } else {
      this.noContactSince ??= now;
    }
    if (person.isPresent && person.smileContactSeconds > 0) {
      this.noSmileSince = null;
    } else {
      this.noSmileSince ??= now;
    }
    const justAppeared = person.isPresent && !this.wasPresent;
    this.wasPresent = person.isPresent;

    const next = this.next(person, now, justAppeared);
    if (next === this.mood) return null;
    this.mood = next;
    this.moodStart = now;
    return next;
  }

  private next(person: PersonState, now: number, justAppeared: boolean): Mood {
    const s = this.settings;
    const contactTime = person.isPresent ? person.contactSeconds : 0;
    const noContactTime = this.noContactSince === null ? 0 : now - this.noContactSince;
    const absentTime = this.absentSince === null ? 0 : now - this.absentSince;

    if (!person.isPresent) {
      if (absentTime >= s.absentToSleep) return 'sleeping';
      // Briefly gone: keep calm moods, drop the person-specific ones.
      if (this.mood === 'sleeping' || this.mood === 'bored') return this.mood;
      return 'curious';
    }
    if (justAppeared && (this.mood === 'sleeping' || (this.mood === 'curious' && this.timeInMood(now) > 2))) {
      return 'surprised';
    }
    if (this.mood === 'surprised' && this.timeInMood(now) < s.surpriseDuration) return 'surprised';
    const noSmileTime = this.noSmileSince === null ? 0 : now - this.noSmileSince;
    const friendly = this.mood === 'happy' || this.mood === 'delighted';
    // Smiling back: ONE camera sees the smile and the eye contact together, for `smileToDelighted` seconds.
    if (s.smileBack && person.smileContactSeconds >= s.smileToDelighted) return 'delighted';
    if (this.mood === 'delighted' && noSmileTime < s.delightedHold && (contactTime > 0 || noContactTime < s.happyHold)) {
      return 'delighted';
    }
    if (contactTime >= s.contactToHappy) return 'happy';
    if (friendly && noContactTime < s.happyHold) return 'happy';
    if (noContactTime >= s.awayToBored) return 'bored';
    // Short glance from bored is not enough: stay bored until real eye contact comes back.
    if (this.mood === 'bored') return 'bored';
    return 'curious';
  }
}
