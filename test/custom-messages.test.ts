import { describe, expect, it } from 'vitest';
import { HAPPY_MESSAGES, InspirationScheduler, messagesFor } from '../src/core/inspirations';

describe('custom messages', () => {
  it('settings round-trip: sanitized, capped, trimmed', async () => {
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    expect(defaultSettings().customMessages).toEqual([]);
    const s = mergeSettings(defaultSettings(), {
      customMessages: ['  Hello there!  ', '', 'x'.repeat(200), 42 as unknown as string, 'Good vibes'],
    });
    expect(s.customMessages).toEqual(['Hello there!', 'x'.repeat(80), 'Good vibes']);
    // At most 100 messages.
    const many = mergeSettings(defaultSettings(), { customMessages: Array.from({ length: 150 }, (_, i) => `m${i}`) });
    expect(many.customMessages.length).toBe(100);
  });

  it('custom messages extend the built-in list', () => {
    const combined = messagesFor({ messageLanguage: 'en', customMessages: ['My own line!'] });
    expect(combined).toContain('My own line!');
    expect(combined.length).toBe(HAPPY_MESSAGES.length + 1);
  });

  it('an empty custom list behaves exactly as before', () => {
    expect(messagesFor({ messageLanguage: 'en', customMessages: [] })).toBe(HAPPY_MESSAGES);
  });

  it('the scheduler draws from the combined list without immediate repeats', async () => {
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const s = mergeSettings(defaultSettings(), {
      customMessages: ['Custom A!', 'Custom B!'],
      inspirationsInterval: 3,
      inspirationsDuration: 5,
    });
    const sched = new InspirationScheduler(s, 3);
    // Record every message start (a new active with a fresh startTime), not text changes:
    // asserting on text changes could never see a repeat in the first place.
    const starts: string[] = [];
    let lastStart = -1;
    for (let t = 0; t < 200; t += 1 / 60) {
      const m = sched.update(t, true);
      if (m && m.startTime !== lastStart) {
        starts.push(m.text);
        lastStart = m.startTime;
      }
    }
    expect(starts).toContain('Custom A!');
    expect(starts).toContain('Custom B!');
    for (let i = 1; i < starts.length; i++) expect(starts[i]).not.toBe(starts[i - 1]);
  });

  it('a Hebrew custom message renders right-to-left even in English mode', async () => {
    const { InspirationScheduler } = await import('../src/core/inspirations');
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const s = mergeSettings(defaultSettings(), {
      messageLanguage: 'en',
      customMessages: ['רק שלי!'],
      inspirationsInterval: 3,
    });
    const sched = new InspirationScheduler(s, 7);
    let mine = null;
    for (let t = 0; t < 400; t += 1 / 60) {
      const m = sched.update(t, true);
      if (m?.text === 'רק שלי!') {
        mine = m;
        break;
      }
    }
    expect(mine).not.toBeNull();
    expect(mine!.rtl).toBe(true);
  });

  it('deduplication: duplicate lines collapse; a built-in copy merges into the pool', async () => {
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const s = mergeSettings(defaultSettings(), { customMessages: ['Same!', 'Same!', 'You are amazing!'] });
    // Duplicates among the customs collapse (settings level).
    expect(s.customMessages).toEqual(['Same!', 'You are amazing!']);
    // A custom identical to a built-in does not double the pool (scheduler level).
    const combined = messagesFor({ messageLanguage: 'en', customMessages: s.customMessages });
    expect(combined.filter((m) => m === 'You are amazing!').length).toBe(1);
    expect(combined.filter((m) => m === 'Same!').length).toBe(1);
  });

  it('a fully custom list replaces the pool it draws from often', async () => {
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const custom = Array.from({ length: 30 }, (_, i) => `Only mine ${i}`);
    const s = mergeSettings(defaultSettings(), { customMessages: custom, inspirationsInterval: 3, inspirationsDuration: 5 });
    const sched = new InspirationScheduler(s, 5);
    const seen = new Set<string>();
    let last: string | null = null;
    for (let t = 0; t < 300; t += 1 / 60) {
      const m = sched.update(t, true);
      if (m && m.text !== last) {
        seen.add(m.text);
        last = m.text;
      }
    }
    // With 30 customs + 25 built-ins over 300 s, several customs appear.
    let customs = 0;
    for (const c of custom) if (seen.has(c)) customs++;
    expect(customs).toBeGreaterThanOrEqual(3);
  });
});
