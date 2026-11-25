import type { Vec2 } from './math';
import { SeededRandom } from './math';

/**
 * When nobody is in front of the camera, the eyes occasionally glance toward the last mouse
 * movement — a quiet "watching you work" moment.
 *
 * - A cursor sighting is fresh for 1.5 s; older ones are ignored.
 * - Glances happen every 2.5–4 s while a fresh cursor position exists, and last ~0.9 s.
 * - While a person is present, the eyes follow the person instead: no cursor glances.
 */
export class CursorGlancer {
  private readonly rng: SeededRandom;
  private cursor: { at: Vec2; time: number } | null = null;
  private glanceEnd = 0;
  private nextGlanceAt = 0;
  private active: Vec2 | null = null;

  constructor(seed = 1) {
    this.rng = new SeededRandom(seed);
  }

  /** The pointer moved; `x`/`y` are 0..1 within this screen, `time` the animator clock. */
  noteCursor(x: number, y: number, time: number): void {
    // Screen y grows down; gaze y grows up.
    this.cursor = { at: { x: (x - 0.5) * 2, y: (0.5 - y) * 2 }, time };
  }

  /** @param present whether a person is detected. Returns the glance direction, or null. */
  update(now: number, present: boolean): Vec2 | null {
    if (now >= this.glanceEnd) this.active = null;
    if (present) {
      this.active = null;
      this.cursor = null;
      return null;
    }
    const fresh = this.cursor && now - this.cursor.time <= 1.5 ? this.cursor : null;
    if (!fresh) {
      // Nothing to look at; the next sighting starts a new wait.
      if (now >= this.nextGlanceAt) this.nextGlanceAt = now + this.rng.range(0.4, 1.2);
      return this.active;
    }
    if (now >= this.nextGlanceAt && this.active === null) {
      this.active = { ...fresh.at };
      this.glanceEnd = now + 0.9;
      this.nextGlanceAt = now + this.rng.range(2.5, 4);
    }
    return this.active;
  }
}
