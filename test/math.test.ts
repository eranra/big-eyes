import { describe, expect, it } from 'vitest';
import { clampLength, length, SeededRandom, smoothingFactor, smoothstep, Spring, vec } from '../src/core';

describe('math helpers', () => {
  it('clampLength keeps the direction', () => {
    const v = clampLength(vec(3, 4), 1);
    expect(length(v)).toBeCloseTo(1, 9);
    expect(v.x).toBeCloseTo(0.6, 9);
    expect(clampLength(vec(0.1, 0.1), 1)).toEqual(vec(0.1, 0.1));
  });

  it('smoothstep edges', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 9);
    expect(smoothstep(1, 1, 0.5)).toBe(0);
  });

  it('smoothingFactor range', () => {
    expect(smoothingFactor(0, 0.2)).toBe(0);
    expect(smoothingFactor(1, 0)).toBe(1);
    expect(smoothingFactor(0.2, 0.2)).toBeCloseTo(1 - Math.exp(-1), 9);
  });

  it('seeded random is repeatable and stays in range', () => {
    const a = new SeededRandom(7);
    const b = new SeededRandom(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    for (let i = 0; i < 500; i++) {
      expect(length(a.inUnitDisk())).toBeLessThanOrEqual(1.000001);
      const r = a.range(2, 3);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThanOrEqual(3);
    }
    expect(['a', 'b', 'c']).toContain(a.pick(['a', 'b', 'c']));
  });
});

describe('Spring', () => {
  const run = (s: Spring, frames: number): number => {
    let max = -Infinity;
    for (let i = 0; i < frames; i++) {
      s.step(1 / 60);
      max = Math.max(max, s.value);
    }
    return max;
  };

  it('settles on the target', () => {
    const s = new Spring(0, 0.3, 1);
    s.target = 1;
    run(s, 120);
    expect(s.isSettled(0.001)).toBe(true);
  });

  it('critical damping does not overshoot', () => {
    const s = new Spring(0, 0.3, 1);
    s.target = 1;
    expect(run(s, 240)).toBeLessThanOrEqual(1.001);
  });

  it('under-damping overshoots', () => {
    const s = new Spring(0, 0.3, 0.5);
    s.target = 1;
    expect(run(s, 240)).toBeGreaterThan(1.05);
  });

  it('stays stable with large time steps', () => {
    const s = new Spring(0, 0.05, 0.3);
    s.target = 1;
    for (let i = 0; i < 20; i++) s.step(5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(10);
  });
});
