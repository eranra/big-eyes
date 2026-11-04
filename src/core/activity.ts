/**
 * Big Eyes' own idle clock, with a filter for mouse jitter.
 *
 * The system idle time resets on *any* input event. Some wireless mice send tiny movements (1-3 pixels)
 * while they lie on the desk, which keeps the system idle time near zero, so the eyes would never appear.
 *
 * This clock samples the pointer position about 10 times per second and keeps its own "last real input" time:
 * - the pointer moved more than `moveThreshold` pixels within `windowSeconds`: real mouse use;
 * - the system idle time reset while the pointer did not move at all: a key press or a click;
 * - the system idle time reset while the pointer moved only a little: jitter, ignored.
 */
export interface ActivityOptions {
  /** Pixels the pointer must travel (in total) within `windowSeconds` to count as mouse use. */
  moveThreshold: number;
  windowSeconds: number;
}

export const DEFAULT_ACTIVITY: ActivityOptions = { moveThreshold: 8, windowSeconds: 2 };

export interface Point {
  x: number;
  y: number;
}

export class ActivityClock {
  private lastInputAt: number;
  private lastSystemIdle: number | null = null;
  private lastPoint: Point | null = null;
  /** Recent pointer moves: time and distance. */
  private moves: Array<{ t: number; d: number }> = [];

  constructor(
    now: number,
    readonly options: ActivityOptions = DEFAULT_ACTIVITY,
  ) {
    this.lastInputAt = now;
  }

  /**
   * Feeds one sample.
   * @param systemIdle seconds from the system idle counter (whole seconds are fine).
   * @param pointer the current pointer position in screen pixels.
   * @returns the filtered idle time in seconds.
   */
  sample(now: number, systemIdle: number, pointer: Point): number {
    const d = this.lastPoint ? Math.abs(pointer.x - this.lastPoint.x) + Math.abs(pointer.y - this.lastPoint.y) : 0;
    this.lastPoint = pointer;
    if (d > 0) this.moves.push({ t: now, d });
    this.moves = this.moves.filter((m) => now - m.t <= this.options.windowSeconds);
    const travelled = this.moves.reduce((sum, m) => sum + m.d, 0);

    // The system saw input since the last sample (its counter went down).
    const systemInput = this.lastSystemIdle !== null && systemIdle + 0.5 < this.lastSystemIdle;
    this.lastSystemIdle = systemIdle;

    if (travelled > this.options.moveThreshold) {
      this.lastInputAt = now; // real mouse use
    } else if (systemInput && d === 0 && this.moves.length === 0) {
      this.lastInputAt = now; // keyboard or click: input without any pointer movement
    }
    // Otherwise: jitter (small moves) or nothing. Keep the old time.

    // Jitter can only make the system idle time smaller, so a larger system value is always true
    // (it also covers the time before the app started).
    return Math.max(now - this.lastInputAt, systemIdle);
  }

  /** Marks real input now (for example after the eyes were dismissed). */
  touch(now: number): void {
    this.lastInputAt = now;
  }

  /** The pointer travelled more than the threshold recently (real mouse use). */
  pointerActive(): boolean {
    return this.moves.reduce((sum, m) => sum + m.d, 0) > this.options.moveThreshold;
  }
}
