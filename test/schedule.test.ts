import { describe, expect, it } from 'vitest';
import { withinSchedule } from '../src/core/schedule';

const at = (h: number, m: number) => new Date(2026, 10, 19, h, m, 0);

describe('withinSchedule', () => {
  it('disabled means always shown', () => {
    expect(withinSchedule({ scheduleEnabled: false, scheduleStart: '09:00', scheduleEnd: '17:00' }, at(3, 0))).toBe(true);
  });

  it('inside a normal window', () => {
    const s = { scheduleEnabled: true, scheduleStart: '09:00', scheduleEnd: '17:00' };
    expect(withinSchedule(s, at(9, 0))).toBe(true); // inclusive start
    expect(withinSchedule(s, at(12, 30))).toBe(true);
    expect(withinSchedule(s, at(17, 0))).toBe(true); // inclusive end
    expect(withinSchedule(s, at(8, 59))).toBe(false);
    expect(withinSchedule(s, at(17, 1))).toBe(false);
  });

  it('an overnight window wraps past midnight', () => {
    const s = { scheduleEnabled: true, scheduleStart: '22:00', scheduleEnd: '06:00' };
    expect(withinSchedule(s, at(23, 0))).toBe(true);
    expect(withinSchedule(s, at(2, 0))).toBe(true);
    expect(withinSchedule(s, at(6, 0))).toBe(true);
    expect(withinSchedule(s, at(12, 0))).toBe(false);
    expect(withinSchedule(s, at(21, 59))).toBe(false);
  });

  it('settings round-trip validates the times and the flag', async () => {
    const { defaultSettings, mergeSettings, normalizeSettings } = await import('../src/core/settings');
    expect(defaultSettings().scheduleEnabled).toBe(false);
    expect(defaultSettings().scheduleStart).toBe('09:00');
    const on = mergeSettings(defaultSettings(), { scheduleEnabled: true, scheduleStart: '10:30', scheduleEnd: '19:00' });
    expect(on.scheduleEnabled).toBe(true);
    expect(on.scheduleStart).toBe('10:30');
    expect(normalizeSettings({ scheduleEnabled: 'yes', scheduleStart: '9:5', scheduleEnd: '25:00' }).scheduleStart).toBe('09:00');
    expect(normalizeSettings({ scheduleStart: '99:99' }).scheduleEnd).toBe('17:00');
  });

  it('the tray menu shows the working-hours toggle, with custom times', async () => {
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const { buildMenuModel } = await import('../src/main/menu-model');
    const menu = buildMenuModel(mergeSettings(defaultSettings(), { scheduleEnabled: true }), [], [], 'darwin');
    const item = menu.find((n) => n.label === 'Working Hours 09:00–17:00');
    expect(item).toBeDefined();
    expect(item!.checked).toBe(true);
    const custom = buildMenuModel(
      mergeSettings(defaultSettings(), { scheduleEnabled: true, scheduleStart: '10:30', scheduleEnd: '19:00' }),
      [],
      [],
      'darwin',
    );
    expect(custom.find((n) => n.label === 'Working Hours 10:30–19:00')).toBeDefined();
  });

  it('invalid times in a hand-edited file fall back to the defaults', async () => {
    const { normalizeSettings } = await import('../src/core/settings');
    const s = normalizeSettings({ scheduleEnabled: true, scheduleStart: '9:00', scheduleEnd: '99:99' });
    expect(s.scheduleStart).toBe('09:00');
    expect(s.scheduleEnd).toBe('17:00');
  });
});
