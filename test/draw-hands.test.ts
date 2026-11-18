import { describe, expect, it } from 'vitest';

describe('drawHands', () => {
  it('drawHands exported', async () => {
    const mod = await import('../src/renderer/draw') as unknown as { drawHands?: unknown };
    expect(typeof mod.drawHands).toBe('function');
  });
});
