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

export type InspirationPosition = 'top' | 'bottom' | 'center';

export interface InspirationSettings {
  showInspirations: boolean;
  inspirationsInterval: number;
  inspirationsDuration: number;
}

export interface ActiveInspiration {
  text: string;
  position: InspirationPosition;
  opacity: number;
  colorIndex: number;
  sizeFactor: number;
}

export const INSPIRATION_COLORS: readonly string[] = [
  'rgba(220, 220, 220, 1)',
  'rgba(200, 205, 215, 1)',
  'rgba(235, 225, 200, 1)',
  'rgba(210, 215, 225, 1)',
  'rgba(240, 220, 210, 1)',
  'rgba(195, 200, 210, 1)',
  'rgba(230, 235, 245, 1)',
  'rgba(225, 215, 195, 1)',
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
    const fadeTime = 0.8;
    const visibleTime = Math.max(0.5, duration - fadeTime * 2);

    if (this.phase === 'idle') {
      const idleElapsed = now - this.phaseStart;
      if (idleElapsed >= interval) {
        this.startNew(now);
      }
      return null;
    }

    if (this.phase === 'showing') {
      const elapsed = now - this.messageStart;
      if (elapsed >= visibleTime) {
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
    let idx: number;
    do {
      idx = Math.floor(this.rng.next() * HAPPY_MESSAGES.length);
    } while (HAPPY_MESSAGES.length > 1 && idx === this.lastIndex);
    this.lastIndex = idx;
    this.active = {
      text: HAPPY_MESSAGES[idx]!,
      position: this.rng.pick([...INSPIRATION_POSITIONS]),
      opacity: 0,
      colorIndex: Math.floor(this.rng.next() * INSPIRATION_COLORS.length),
      sizeFactor: this.rng.range(0.85, 1.35),
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
