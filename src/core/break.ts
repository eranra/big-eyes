/** The message shown when it is time for a break. */
export const BREAK_NUDGE_TEXT = 'Time to stretch?';
/** How long the break nudge message stays on screen, seconds. */
export const BREAK_NUDGE_SECONDS = 6;
/** An absence at least this long (s) resets the presence stretch. */
export const BREAK_RESET_ABSENCE = 20;

/** State that survives the eyes being hidden and shown again (see `seed` / `state`). */
export interface BreakState {
  presentSince: number | null;
  fired: boolean;
}

/**
 * A gentle health nudge: after `minutes` of continuous presence at the screen, the eyes suggest
 * a stretch. Fires at most once per presence stretch; a real break (an absence of 20 s or more)
 * resets the stretch. `minutes <= 0` turns it off.
 *
 * The presence stretch is meant to be continuous across eye sessions (the eyes hide on any
 * input while the person often stays), so the overlay carries `state()` over recreations.
 */
export class BreakTimer {
  /** Minutes of continuous presence before the nudge; 0 = off. */
  minutes: number;
  private presentSince: number | null = null;
  private absentSince: number | null = null;
  private fired = false;

  constructor(minutes = 0) {
    this.minutes = minutes;
  }

  /** Carries a stretch over from a previous animator (same window clock). */
  seed(state: BreakState): void {
    this.presentSince = state.presentSince;
    this.fired = state.fired;
  }

  /** The current stretch, to seed the next animator with. */
  state(): BreakState {
    return { presentSince: this.presentSince, fired: this.fired };
  }

  /**
   * @param now seconds on the animator clock.
   * @param present whether a person is detected right now.
   * @returns true on the single update when the nudge becomes due.
   */
  update(now: number, present: boolean): boolean {
    if (this.minutes <= 0) {
      this.presentSince = null;
      this.absentSince = null;
      this.fired = false;
      return false;
    }
    if (present) {
      const absence = this.absentSince === null ? 0 : now - this.absentSince;
      if (this.presentSince === null || absence >= BREAK_RESET_ABSENCE) {
        // A new presence stretch starts (also right after a real break).
        this.presentSince = now;
        this.fired = false;
      }
      this.absentSince = null;
      if (!this.fired && now - this.presentSince >= this.minutes * 60) {
        this.fired = true;
        return true;
      }
      return false;
    }
    this.absentSince ??= now;
    this.presentSince ??= now; // keep the stretch through short gaps
    return false;
  }
}
