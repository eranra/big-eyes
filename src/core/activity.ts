/**
 * Big Eyes' own idle clock, with a filter for mouse jitter.
 *
 * Some wireless mice send tiny movements (1-3 pixels) while they lie on the desk. Those reset the system idle
 * time, so without a filter the eyes would never appear. But the filter must never ignore real use: typing,
 * clicking, scrolling or moving the mouse must always keep the eyes away.
 *
 * The rule, checked 10 times per second:
 * - Keys, clicks, scrolling: always input.
 * - Mouse movement: input only when the pointer travelled more than `moveThreshold` pixels within `windowSeconds`.
 *
 * On macOS the app gets separate counters per event type (keys, clicks, scroll, mouse move) from a tiny helper,
 * so the rule is exact. On Windows and Linux only the combined system idle time exists. There the rule is safe
 * rather than exact: input always counts, except separate single wobbles (an input moment that starts with a
 * small pointer move, with no other input for at least `JITTER_GAP_SECONDS` before it). When in doubt the eyes
 * stay away, because opening them while someone types is the worse mistake.
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

/** Seconds since the last event of each kind (macOS idle helper). */
export interface InputKinds {
  key: number;
  click: number;
  scroll: number;
  move: number;
}

/** Parses one line of the macOS idle helper ("key click scroll move"). Returns null for anything else. */
export function parseInputKinds(line: string): InputKinds | null {
  const parts = line.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [key, click, scroll, move] = parts as [number, number, number, number];
  return { key, click, scroll, move };
}

/** A wobble counts as jitter only if there was no input for at least this long before it. */
const JITTER_GAP_SECONDS = 2;

export class ActivityClock {
  private lastInputAt: number;
  private lastPoint: Point | null = null;
  /** Recent pointer moves: time and distance. */
  private moves: Array<{ t: number; d: number }> = [];
  /** Combined-counter mode: time of the previous sample that saw system input, and whether the current input
   *  moment was judged to be a lone wobble. */
  private lastSystemInputAt = -Infinity;
  private momentIsJitter = false;

  constructor(
    now: number,
    readonly options: ActivityOptions = DEFAULT_ACTIVITY,
  ) {
    this.lastInputAt = now;
  }

  /**
   * Feeds one sample.
   * @param systemIdle seconds from the combined system idle counter (whole seconds are fine).
   * @param pointer the current pointer position in screen pixels.
   * @param kinds per-event-type counters, when the system has them (macOS).
   * @returns the filtered idle time in seconds.
   */
  sample(now: number, systemIdle: number, pointer: Point, kinds?: InputKinds | null): number {
    const d = this.lastPoint ? Math.abs(pointer.x - this.lastPoint.x) + Math.abs(pointer.y - this.lastPoint.y) : 0;
    this.lastPoint = pointer;
    if (d > 0) this.moves.push({ t: now, d });
    this.moves = this.moves.filter((m) => now - m.t <= this.options.windowSeconds);
    const travelled = this.moves.reduce((sum, m) => sum + m.d, 0);
    const mouseUse = travelled > this.options.moveThreshold;

    if (kinds) {
      // Exact: keys, clicks and scrolling count; mouse movement counts above the threshold.
      const lastNonMove = Math.min(kinds.key, kinds.click, kinds.scroll);
      if (mouseUse) this.lastInputAt = now;
      this.lastInputAt = Math.max(this.lastInputAt, now - lastNonMove);
      return now - this.lastInputAt;
    }

    // Combined counter only.
    const systemInput = systemIdle < 1;
    if (systemInput) {
      const newMoment = now - this.lastSystemInputAt > 1.2;
      if (newMoment) {
        // A new input moment. It is jitter only if it starts with a small pointer move after a quiet gap.
        const quietBefore = now - this.lastSystemInputAt >= JITTER_GAP_SECONDS;
        this.momentIsJitter = quietBefore && d > 0 && !mouseUse;
      }
      this.lastSystemInputAt = now;
    }
    if (mouseUse || (systemInput && !this.momentIsJitter)) this.lastInputAt = now;
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
