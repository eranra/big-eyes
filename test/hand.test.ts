import { describe, expect, it } from 'vitest';
import { HandScheduler } from '../src/core/hand';

describe('HandScheduler', () => {
  it('sleeping waves', () => {
    const h = new HandScheduler({ showHands: true } as never, 1);
    const p = h.update(0, 'sleeping', null, true);
    expect(p.gesture).toBe('wave');
  });
  it('hidden when showHands false', () => {
    const h = new HandScheduler({ showHands: false } as never, 1);
    expect(h.update(0, 'happy', null, false).opacity).toBe(0);
  });
});
