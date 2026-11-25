import { SeededRandom } from './math';

/** What floats up while the eyes sleep. */
export type DreamKind = 'star' | 'heart';

/** One dream bubble floating up from beside the sleeping eyes. */
export interface DreamBubble {
  kind: DreamKind;
  /** Time (s, animator clock) the bubble appeared. */
  startTime: number;
}

/** How long one bubble lives on screen, seconds. */
export const DREAM_LIFETIME = 3.2;
/** Longest gap between bubbles, seconds. The shortest is 5. */
export const DREAM_MAX_GAP = 9;

/**
 * While the eyes sleep, a small star or heart occasionally floats up from beside them.
 * Awake: nothing, and the timer resets so the next sleep waits a full gap first.
 */
export class DreamScheduler {
  bubble: DreamBubble | null = null;
  private readonly rng: SeededRandom;
  private lastSpawn = 0;
  private gap = 7;
  private wasSleeping = false;

  constructor(seed = 1) {
    this.rng = new SeededRandom(seed);
  }

  /** @param sleeping whether the eyes are sleeping now. Returns the live bubble, or null. */
  update(now: number, sleeping: boolean): DreamBubble | null {
    if (!sleeping) {
      if (this.wasSleeping) {
        this.wasSleeping = false;
        this.bubble = null;
        this.lastSpawn = now;
        this.gap = this.rng.range(5, DREAM_MAX_GAP);
      }
      return null;
    }
    if (!this.wasSleeping) {
      this.wasSleeping = true;
      this.lastSpawn = now;
      this.gap = this.rng.range(5, DREAM_MAX_GAP);
      this.bubble = null;
    }
    if (this.bubble && now - this.bubble.startTime > DREAM_LIFETIME) this.bubble = null;
    if (!this.bubble && now - this.lastSpawn >= this.gap) {
      this.bubble = { kind: this.rng.next() < 0.6 ? 'star' : 'heart', startTime: now };
      this.lastSpawn = now;
      this.gap = this.rng.range(5, DREAM_MAX_GAP);
    }
    return this.bubble;
  }
}
