import { SeededRandom, type Vec2 } from './math';

export const HAPPY_MESSAGES: readonly string[] = [
  'You are amazing!',
  'Keep shining!',
  'Smile — the world needs it!',
  'You make a difference!',
  'Today is your day!',
  'Believe in yourself!',
  'You are loved!',
  'Dream big!',
  'Stay awesome!',
  'You got this!',
  'Spread kindness!',
  'Be your best self!',
  'Magic is inside you!',
  'You light up the room!',
  'Keep going — you rock!',
  'Happiness looks good on you!',
  'You are unstoppable!',
  'Make today wonderful!',
  'Your smile is beautiful!',
  'Stay curious, stay kind!',
  'You inspire others!',
  'Every day is a new chance!',
  'You are braver than you think!',
  'Shine bright!',
  'Life is beautiful!',
];

/** The same messages in Hebrew, shown when the message language is Hebrew. */
export const HAPPY_MESSAGES_HE: readonly string[] = [
  'אתה מדהים!',
  'המשך להאיר!',
  'תחייך — העולם צריך את זה!',
  'אתה עושה שינוי!',
  'היום זה היום שלך!',
  'תאמין בעצמך!',
  'אוהבים אותך!',
  'חלום גדול!',
  'תישאר מדהים!',
  'אתה תסתדר!',
  'פזר טוב סביבך!',
  'תהיה הגרסה הכי טובה שלך!',
  'קסם נמצא בתוכך!',
  'אתה מאיר את החדר!',
  'תמשיך — אתה מדליק!',
  'האושר יפה עליך!',
  'אי אפשר לעצור אותך!',
  'תעשה את היום נפלא!',
  'החיוך שלך יפה!',
  'תישאר סקרן, תישאר טוב!',
  'אתה מעורר השראה!',
  'כל יום הזדמנות חדשה!',
  'אתה אמיץ יותר ממה שאתה חושב!',
  'תאיר חזק!',
  'החיים יפים!',
];

export type InspirationPosition = 'top' | 'bottom' | 'center';

/** The message list for a language, with the user's own messages added. */
export function messagesFor(
  s: Pick<InspirationSettings, 'messageLanguage'> & { customMessages?: readonly string[] },
): readonly string[] {
  const base = s.messageLanguage === 'he' ? HAPPY_MESSAGES_HE : HAPPY_MESSAGES;
  const custom = s.customMessages ?? [];
  if (!custom.length) return base;
  const seen = new Set(base);
  const extras = custom.filter((m) => !seen.has(m) && Boolean(seen.add(m)));
  return [...base, ...extras];
}

export interface InspirationSettings {
  showInspirations: boolean;
  inspirationsInterval: number;
  inspirationsDuration: number;
  /** Message language: 'he' shows the Hebrew list, right-to-left. */
  messageLanguage: 'en' | 'he';
  /** The user's own messages, added to the built-in list. */
  customMessages: string[];
}

export interface ActiveInspiration {
  text: string;
  position: InspirationPosition;
  opacity: number;
  colorIndex: number;
  sizeFactor: number;
  startTime: number;
  /** True when the text is right-to-left (Hebrew). */
  rtl: boolean;
}

export const INSPIRATION_COLORS: readonly string[] = [
  'rgba(255, 220, 80, 1)',
  'rgba(255, 100, 120, 1)',
  'rgba(80, 220, 255, 1)',
  'rgba(255, 160, 60, 1)',
  'rgba(120, 255, 140, 1)',
  'rgba(255, 110, 200, 1)',
  'rgba(100, 160, 255, 1)',
  'rgba(255, 240, 100, 1)',
  'rgba(80, 255, 200, 1)',
  'rgba(255, 90, 90, 1)',
];

export const INSPIRATION_POSITIONS: readonly InspirationPosition[] = ['top', 'bottom', 'center'];

export function inspirationGazeTarget(pos: InspirationPosition): Vec2 {
  switch (pos) {
    case 'top': return { x: 0, y: 0.75 };
    case 'bottom': return { x: 0, y: -0.55 };
    case 'center': return { x: 0, y: 0.15 };
  }
}

export class InspirationScheduler {
  settings: InspirationSettings;
  active: ActiveInspiration | null = null;

  private readonly rng: SeededRandom;
  private phase: 'idle' | 'showing' | 'fadingOut' = 'idle';
  private phaseStart = 0;
  private lastIndex = -1;
  private messageStart = 0;

  constructor(settings: InspirationSettings, seed = 42) {
    this.settings = settings;
    this.rng = new SeededRandom(seed);
  }

  reset(now: number): void {
    this.active = null;
    this.phase = 'idle';
    this.phaseStart = now;
    this.messageStart = 0;
  }

  update(now: number, eligible: boolean): ActiveInspiration | null {
    if (!this.settings.showInspirations || !eligible) {
      this.active = null;
      this.phase = 'idle';
      this.phaseStart = now;
      return null;
    }

    const { inspirationsInterval: interval, inspirationsDuration: duration } = this.settings;
    const fadeTime = 0.6;

    if (this.phase === 'idle') {
      const idleElapsed = now - this.phaseStart;
      if (idleElapsed >= interval) {
        this.startNew(now);
      }
      return null;
    }

    if (this.phase === 'showing') {
      const elapsed = now - this.messageStart;
      const showFor = Math.max(fadeTime + 0.5, duration - fadeTime);
      if (elapsed >= showFor) {
        this.phase = 'fadingOut';
        this.phaseStart = now;
      }
      if (this.active) this.active.opacity = fadeInOpacity(elapsed, fadeTime);
      return this.active;
    }

    if (this.phase === 'fadingOut') {
      const elapsed = now - this.phaseStart;
      if (elapsed >= fadeTime) {
        this.phase = 'idle';
        this.phaseStart = now;
        this.active = null;
        return null;
      }
      if (this.active) this.active.opacity = 1 - elapsed / fadeTime;
      return this.active;
    }

    return null;
  }

  private startNew(now: number): void {
    const messages = messagesFor(this.settings);
    let idx: number;
    do {
      idx = Math.floor(this.rng.next() * messages.length);
    } while (messages.length > 1 && idx === this.lastIndex);
    this.lastIndex = idx;
    const text = messages[idx]!;
    this.active = {
      text,
      position: this.rng.pick([...INSPIRATION_POSITIONS]),
      opacity: 0,
      colorIndex: Math.floor(this.rng.next() * INSPIRATION_COLORS.length),
      sizeFactor: this.rng.range(1.15, 1.6),
      startTime: now,
      // Right-to-left per message, not per language: a Hebrew custom message renders correctly
      // even in English mode, and an English one in Hebrew mode stays left-to-right.
      rtl: /[\u0590-\u05FF]/.test(text),
    };
    this.phase = 'showing';
    this.phaseStart = now;
    this.messageStart = now;
  }
}

function fadeInOpacity(elapsed: number, fadeTime: number): number {
  if (elapsed < fadeTime) return elapsed / fadeTime;
  return 1;
}
