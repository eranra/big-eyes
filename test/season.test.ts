import { describe, expect, it } from 'vitest';
import { seasonFor } from '../src/core/season';
import { drawSeason } from '../src/renderer/draw';

describe('seasonFor', () => {
  it('December snows', () => {
    expect(seasonFor(new Date(2026, 11, 1))).toBe('snow');
    expect(seasonFor(new Date(2026, 11, 24))).toBe('snow');
    expect(seasonFor(new Date(2027, 0, 1))).toBeNull(); // January: nothing
  });

  it('autumn leaves, September through November', () => {
    expect(seasonFor(new Date(2026, 8, 1))).toBe('leaves');
    expect(seasonFor(new Date(2026, 9, 15))).toBe('leaves');
    expect(seasonFor(new Date(2026, 10, 30))).toBe('leaves');
    expect(seasonFor(new Date(2026, 7, 31))).toBeNull(); // August
    expect(seasonFor(new Date(2027, 0, 2))).toBeNull();
  });

  it('hearts on February 14 only', () => {
    expect(seasonFor(new Date(2027, 1, 14))).toBe('hearts');
    expect(seasonFor(new Date(2027, 1, 13))).toBeNull();
    expect(seasonFor(new Date(2027, 1, 15))).toBeNull();
  });

  it('the rest of the year has no season', () => {
    for (const month of [0, 2, 3, 4, 5, 6, 7]) {
      expect(seasonFor(new Date(2026, month, 10))).toBeNull();
    }
  });
});

describe('drawSeason', () => {
  interface Spy {
    ctx: CanvasRenderingContext2D;
    fills: number[];
    points: Array<{ x: number; y: number }>;
  }
  const makeCtx = (): Spy => {
    const fills: number[] = [];
    const points: Array<{ x: number; y: number }> = [];
    const ctx = {
      fill: () => fills.push(1), stroke: () => {}, save() {}, restore() {}, beginPath() {},
      closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      ellipse: (x: number, y: number) => points.push({ x, y }),
      arc: (x: number, y: number) => points.push({ x, y }),
      clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {}, translate: (x: number, y: number) => points.push({ x, y }),
      rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;
    return { ctx, fills, points };
  };

  it('renders exactly 14 particles per season, and nothing without one', () => {
    for (const season of ['snow', 'leaves', 'hearts'] as const) {
      const { ctx, fills } = makeCtx();
      drawSeason(ctx, 900, 700, 3.5, season);
      expect(fills.length).toBe(14);
    }
    const { ctx, fills } = makeCtx();
    drawSeason(ctx, 900, 700, 3.5, null);
    expect(fills.length).toBe(0);
  });

  it('every particle stays on the canvas', () => {
    for (const season of ['snow', 'leaves', 'hearts'] as const) {
      const { ctx, points } = makeCtx();
      drawSeason(ctx, 900, 700, 42.7, season);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(900);
        expect(p.y).toBeGreaterThanOrEqual(-20);
        expect(p.y).toBeLessThanOrEqual(720);
      }
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(900);
        expect(p.y).toBeGreaterThanOrEqual(-20);
        expect(p.y).toBeLessThanOrEqual(720);
      }
    }
  });

  it('the same time renders exactly the same particles (deterministic)', () => {
    const a = makeCtx();
    const b = makeCtx();
    drawSeason(a.ctx, 900, 700, 123.4, 'snow');
    drawSeason(b.ctx, 900, 700, 123.4, 'snow');
    expect(a.points).toEqual(b.points);
  });

  it('snow falls and hearts rise', () => {
    const snowEarly = makeCtx();
    drawSeason(snowEarly.ctx, 900, 700, 0, 'snow');
    const snowLate = makeCtx();
    drawSeason(snowLate.ctx, 900, 700, 5, 'snow');
    // Snow: later means lower (bigger y), and positions are in the same order per particle.
    let fell = 0;
    for (let i = 0; i < 14; i++) {
      const d = snowLate.points[i]!.y - snowEarly.points[i]!.y;
      // Fell, or wrapped past the bottom back to the top (a large negative jump).
      if (d > 1 || d < -300) fell++;
    }
    expect(fell).toBeGreaterThanOrEqual(13);

    const heartEarly = makeCtx();
    drawSeason(heartEarly.ctx, 900, 700, 0, 'hearts');
    const heartLate = makeCtx();
    drawSeason(heartLate.ctx, 900, 700, 5, 'hearts');
    let rose = 0;
    for (let i = 0; i < 14; i++) {
      const d = heartLate.points[i]!.y - heartEarly.points[i]!.y;
      // Rose, or wrapped past the top back to the bottom (a large positive jump).
      if (d < -1 || d > 300) rose++;
    }
    expect(rose).toBeGreaterThanOrEqual(13);
  });
});
