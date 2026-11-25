import { describe, expect, it } from 'vitest';
import { seasonFor } from '../src/core/season';

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
  it('renders particles for each season and nothing without one', async () => {
    const { drawSeason } = await import('../src/renderer/draw');
    const makeCtx = (): { ctx: CanvasRenderingContext2D; fills: number[] } => {
      const fills: number[] = [];
      const ctx = {
        fill: () => fills.push(1), stroke: () => {}, save() {}, restore() {}, beginPath() {},
        closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
        ellipse() {}, arc() {}, clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {},
        translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeText() {},
        measureText: () => ({ width: 10 }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
      } as unknown as CanvasRenderingContext2D;
      return { ctx, fills };
    };
    for (const season of ['snow', 'leaves', 'hearts'] as const) {
      const { ctx, fills } = makeCtx();
      drawSeason(ctx, 900, 700, 3.5, season);
      expect(fills.length).toBeGreaterThan(5);
    }
    const { ctx, fills } = makeCtx();
    drawSeason(ctx, 900, 700, 3.5, null);
    expect(fills.length).toBe(0);
  });

  it('particles move over time (falling snow reaches lower over time)', async () => {
    const { drawSeason } = await import('../src/renderer/draw');
    // Deterministic positions: spy on ellipse/arc y coordinates at two times.
    const positions: number[] = [];
    const ctx = {
      fill: () => {}, stroke: () => {}, save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      ellipse: (_x: number, y: number) => positions.push(y), arc: (_x: number, y: number) => positions.push(y),
      clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {}, translate() {}, rotate() {},
      scale() {}, setTransform() {}, fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;
    drawSeason(ctx, 900, 700, 0, 'snow');
    const at0 = [...positions];
    positions.length = 0;
    drawSeason(ctx, 900, 700, 5, 'snow');
    expect(at0.length).toBe(positions.length);
    let moved = 0;
    for (let i = 0; i < positions.length; i++) {
      if (Math.abs(positions[i]! - at0[i]!) > 0.5) moved++;
    }
    expect(moved).toBeGreaterThan(3); // most particles fell
  });
});
