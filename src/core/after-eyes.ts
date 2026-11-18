/**
 * "Replace the screen saver" mode, after the eyes have been there for a while: Big Eyes hands over to the system
 * (starts the real screen saver, or locks the screen) once per idle stretch.
 *
 * - `update` returns 'due' once the idle time reaches `dueAt` (seconds of no input), and keeps returning 'due'
 *   until `handOff()` is called (for example while a video keeps the display awake).
 * - After `handOff()`, Big Eyes stays out of the way (no eyes, no screen saver blocker) until new input.
 *   `update` then returns 'back' once, and the next idle stretch starts again.
 */
export class AfterEyesTimer {
  private handed = false;
  private lastIdle = 0;

  /** True from `handOff()` until new keyboard or mouse input. */
  get handedOff(): boolean {
    return this.handed;
  }

  /**
   * @param idleSeconds seconds since the last real input.
   * @param dueAt seconds of no input after which the action happens, or null when it never does.
   */
  update(idleSeconds: number, dueAt: number | null): 'due' | 'back' | null {
    // New input: the idle time went down (by more than timer noise), or is near zero.
    const input = idleSeconds < 1 || idleSeconds + 0.5 < this.lastIdle;
    this.lastIdle = idleSeconds;
    if (this.handed) {
      if (!input) return null;
      this.handed = false;
      return 'back';
    }
    return dueAt !== null && idleSeconds >= dueAt ? 'due' : null;
  }

  /** The action ran: stay out of the way until new input. */
  handOff(): void {
    this.handed = true;
  }

  /** Forget the hand-off (for example when the user turns the option off). */
  reset(): void {
    this.handed = false;
  }
}
