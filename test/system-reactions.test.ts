import { describe, expect, it } from 'vitest';
import { parsePowerSource, isACPower } from '../src/main/system';

describe('power source parsing', () => {
  it('detects AC power from pmset output (macOS)', () => {
    expect(parsePowerSource("Now drawing from 'AC Power'\n-InternalBattery-0 82%")).toBe(true);
    expect(parsePowerSource("Now drawing from 'Battery Power'\n-InternalBattery-0 82%")).toBe(false);
    expect(parsePowerSource('garbage')).toBe(false);
    expect(parsePowerSource(null)).toBe(false);
  });

  it('detects AC power on Linux (/sys style)', () => {
    expect(parsePowerSource('1\n')).toBe(true);
    expect(parsePowerSource('0\n')).toBe(false);
  });

  it('isACPower never throws', async () => {
    await expect(isACPower()).resolves.toBeDefined();
  });
});
