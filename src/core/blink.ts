import { SeededRandom, smoothstep } from './math';

export const CLOSE_DURATION = 0.075;
export const HOLD_DURATION = 0.035;
export const OPEN_DURATION = 0.15;

/**
 * Creates natural, slightly random blinks.
 *
 * People blink every 2-6 seconds, sometimes twice in a row, and close the lid faster than they open it.
 */
export class BlinkScheduler {
  nextBlinkAt: number;
  /** Values above 1 make blinks slower (bored, sleepy). */
  slowness = 1;
  /** Multiplier for the time between blinks. */
  intervalScale = 1;
  /** User setting: how often (0 = never, 1 = normal). Divides the time between blinks. */
  rate = 1;
  /** User setting: how fast one blink is (1 = normal, 2 = twice as fast). */
  speed = 1;
  enabled = true;
  private blinkStart: number | null = null;
  private pendingDouble = false;
  private readonly rng: SeededRandom;

  constructor(seed = 1, now = 0) {
    this.rng = new SeededRandom(seed);
    this.nextBlinkAt = now + 1.2;
  }

  /** Starts a blink now unless one is already running. */
  trigger(now: number): void {
    this.blinkStart ??= now;
  }

  /** Lid closure caused by blinking at time `now`: 0 = open, 1 = closed. */
  closure(now: number): number {
    if (this.blinkStart === null && this.enabled && this.rate > 0 && now >= this.nextBlinkAt) {
      this.blinkStart = now;
      this.pendingDouble = this.rng.next() < 0.15;
    }
    if (this.blinkStart === null) return 0;
    const t = now - this.blinkStart;
    const k = this.slowness / Math.max(this.speed, 0.1);
    const close = CLOSE_DURATION * k;
    const hold = HOLD_DURATION * k;
    const open = OPEN_DURATION * k;
    if (t < close) return smoothstep(0, 1, t / close);
    if (t < close + hold) return 1;
    if (t < close + hold + open) return 1 - smoothstep(0, 1, (t - close - hold) / open);
    this.blinkStart = null;
    if (this.pendingDouble) {
      this.pendingDouble = false;
      this.nextBlinkAt = now + 0.12;
    } else {
      this.nextBlinkAt = now + (this.rng.range(1.8, 5.5) * this.intervalScale) / Math.max(this.rate, 0.05);
    }
    return 0;
  }
}
