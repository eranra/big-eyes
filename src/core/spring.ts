import { clamp, type Vec2 } from './math';

/**
 * A damped spring that moves `value` toward `target`.
 *
 * Springs give the eyes their "alive" feel: movements speed up, slow down, and can overshoot a little,
 * instead of moving in straight lines. Parameters follow the SwiftUI convention:
 * - `response`: about how long (seconds) one oscillation takes. Smaller is faster.
 * - `dampingRatio`: 1 means no overshoot, below 1 means some bounce.
 */
export class Spring {
  value: number;
  velocity = 0;
  target: number;
  private stiffness = 0;
  private damping = 0;

  constructor(value = 0, response = 0.3, dampingRatio = 1) {
    this.value = value;
    this.target = value;
    this.configure(response, dampingRatio);
  }

  configure(response: number, dampingRatio: number): void {
    const omega = (2 * Math.PI) / Math.max(response, 0.001);
    this.stiffness = omega * omega;
    this.damping = 2 * Math.max(dampingRatio, 0) * omega;
  }

  /** Advances the spring by `dt` seconds. Small fixed sub-steps keep it stable for large `dt`. */
  step(dt: number): void {
    let remaining = clamp(dt, 0, 0.25);
    const maxStep = 1 / 240;
    while (remaining > 0) {
      const h = Math.min(remaining, maxStep);
      const acceleration = this.stiffness * (this.target - this.value) - this.damping * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
      remaining -= h;
    }
  }

  isSettled(tolerance = 0.001): boolean {
    return Math.abs(this.target - this.value) < tolerance && Math.abs(this.velocity) < tolerance;
  }
}

/** Two springs, one per axis. */
export class Spring2D {
  readonly x: Spring;
  readonly y: Spring;

  constructor(value: Vec2 = { x: 0, y: 0 }, response = 0.3, dampingRatio = 1) {
    this.x = new Spring(value.x, response, dampingRatio);
    this.y = new Spring(value.y, response, dampingRatio);
  }

  get value(): Vec2 {
    return { x: this.x.value, y: this.y.value };
  }

  setTarget(target: Vec2): void {
    this.x.target = target.x;
    this.y.target = target.y;
  }

  step(dt: number): void {
    this.x.step(dt);
    this.y.step(dt);
  }
}
