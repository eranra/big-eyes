/** A small 2D vector. Plain object so it can cross IPC and JSON without conversion. */
export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const ZERO: Readonly<Vec2> = Object.freeze({ x: 0, y: 0 });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const isFiniteVec = (a: Vec2): boolean => Number.isFinite(a.x) && Number.isFinite(a.y);

/** Returns `a` shortened to `max` if it is longer. The direction is kept. */
export function clampLength(a: Vec2, max: number): Vec2 {
  const len = length(a);
  if (len <= max || len === 0) return a;
  return scale(a, max / len);
}

export const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Smooth 0..1 step between `edge0` and `edge1` (Hermite curve). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Fraction (0..1) to move toward a target this frame, for exponential smoothing with time constant `tau`. */
export function smoothingFactor(dt: number, tau: number): number {
  if (tau <= 0) return 1;
  return 1 - Math.exp(-Math.max(dt, 0) / tau);
}

/**
 * Deterministic random numbers (mulberry32). Tests use fixed seeds to get repeatable behavior.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** Uniform value in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform value in [low, high]. */
  range(low: number, high: number): number {
    return low + (high - low) * this.next();
  }

  /** Uniform point inside the unit disk. */
  inUnitDisk(): Vec2 {
    const angle = this.range(0, Math.PI * 2);
    const radius = Math.sqrt(this.next());
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  /** One element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))]!;
  }
}
