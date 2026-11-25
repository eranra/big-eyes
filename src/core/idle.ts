/**
 * Decides when the overlay shows and hides.
 *
 * Show: no keyboard or mouse input for `timeout` seconds.
 * Hide:
 * - a key press or a mouse click (the system idle time resets while the pointer did not move);
 * - mouse movement, depending on `mouseRule`: onto the eyes ('onto-eyes', default), any movement ('any'),
 *   or never ('never');
 * - showing is blocked (paused, screen locked).
 *
 * Electron's `powerMonitor.getSystemIdleTime()` returns whole seconds and counts every kind of input.
 * We compare it with the idle time we expect if there was no input since the last check that had
 * mouse movement. A 1.5 s margin covers the whole-second rounding.
 */
import type { MouseRule } from './settings';

export type IdleEvent = 'show' | 'hide';

export interface IdleInput {
  /** Seconds since the last keyboard/mouse input (whole seconds are fine). */
  idleSeconds: number;
  /** Current time in seconds (any monotonic clock). */
  now: number;
  /** True when showing is not allowed now: paused, screen locked, video playing. */
  blocked?: boolean;
  /** True when the mouse pointer moved since the last update. */
  pointerMoved?: boolean;
  /** True when the mouse pointer is inside the area of the eyes. */
  pointerInEyes?: boolean;
  /** What mouse movement does. Default 'onto-eyes'. */
  mouseRule?: MouseRule;
}

/** Why the overlay was hidden. Useful for logs and tests. */
export type HideReason = 'input' | 'pointer-in-eyes' | 'pointer-moved' | 'blocked' | 'forced';

/**
 * The mouse rule that applies while the eyes are shown. With look-to-close on, moving the pointer onto
 * the eyes no longer closes them — the look is the goodbye, so the gaze timer gets to finish.
 * A key press or a click always closes the eyes, and an explicit "any mouse movement" choice still applies.
 */
export function effectiveMouseRule(mouseRule: MouseRule, lookToClose: boolean): MouseRule {
  return lookToClose && mouseRule === 'onto-eyes' ? 'never' : mouseRule;
}

export class IdleMonitor {
  timeout: number;
  isShowing = false;
  lastHideReason: HideReason | null = null;
  /** Time and idle seconds of the last baseline (when shown, or when the mouse last moved). */
  private baseTime = 0;
  private baseIdle = 0;
  /** After a dismissal, wait for a new idle period before showing again. */
  private armed = true;
  private showListeners: Array<() => void> = [];

  constructor(timeout: number) {
    this.timeout = timeout;
  }

  /** Called every time the eyes appear (also on "Show eyes now"). */
  onShow(listener: () => void): void {
    this.showListeners.push(listener);
  }

  private fireShow(): void {
    for (const l of this.showListeners) l();
  }

  update({
    idleSeconds,
    now,
    blocked = false,
    pointerMoved = false,
    pointerInEyes = false,
    mouseRule = 'onto-eyes',
  }: IdleInput): IdleEvent | null {
    if (this.isShowing) {
      if (blocked) return this.hide('blocked');
      if (pointerMoved && mouseRule === 'any') return this.hide('pointer-moved');
      if (pointerMoved && pointerInEyes && mouseRule === 'onto-eyes') return this.hide('pointer-in-eyes');
      if (pointerMoved) {
        // Mouse-only input: the idle time resets, but this is allowed. Start a new baseline.
        this.baseTime = now;
        this.baseIdle = idleSeconds;
        return null;
      }
      const expectedIdle = this.baseIdle + (now - this.baseTime);
      if (idleSeconds < expectedIdle - 1.5) return this.hide('input');
      return null;
    }
    if (idleSeconds < this.timeout) this.armed = true;
    if (this.armed && !blocked && idleSeconds >= this.timeout) {
      this.show(now, idleSeconds);
      return 'show';
    }
    return null;
  }

  /**
   * True when `update` would show the eyes at this idle time (not showing, armed, idle long enough).
   * After the eyes were dismissed they are not armed until new input, so this stays false until then.
   */
  canShow(idleSeconds: number): boolean {
    return !this.isShowing && (this.armed || idleSeconds < this.timeout) && idleSeconds >= this.timeout;
  }

  /** Shows now, for example from the menu ("Show eyes now"). */
  forceShow(now: number, idleSeconds: number): IdleEvent | null {
    if (this.isShowing) return null;
    this.show(now, idleSeconds);
    return 'show';
  }

  forceHide(): IdleEvent | null {
    return this.isShowing ? this.hide('forced') : null;
  }

  private show(now: number, idleSeconds: number): void {
    this.isShowing = true;
    this.lastHideReason = null;
    this.baseTime = now;
    this.baseIdle = idleSeconds;
    this.fireShow();
  }

  private hide(reason: HideReason): IdleEvent {
    this.isShowing = false;
    this.armed = false;
    this.lastHideReason = reason;
    return 'hide';
  }
}

/** A rectangle in screen coordinates. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when the point is inside any of the rectangles, each grown by `margin` pixels on every side. */
export function pointInRects(point: { x: number; y: number }, rects: readonly Rect[], margin = 0): boolean {
  return rects.some(
    (r) =>
      point.x >= r.x - margin &&
      point.x <= r.x + r.width + margin &&
      point.y >= r.y - margin &&
      point.y <= r.y + r.height + margin,
  );
}
