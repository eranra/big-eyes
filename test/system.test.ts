import { describe, expect, it } from 'vitest';
import { linuxAutostartEntry, parsePmsetAssertions } from '../src/main/system';

describe('pmset parsing', () => {
  const sample = (display: number, noDisplay: number): string => `Assertion status system-wide:
   BackgroundTask                 0
   UserIsActive                   1
   PreventUserIdleDisplaySleep    ${display}
   NoDisplaySleepAssertion        ${noDisplay}
Listed by owning process:
   pid 123(coreaudiod): [0x0001] 00:10:00 PreventUserIdleSystemSleep named: "com.apple.audio"
${display ? '   pid 900(QuickTime Player): [0x0002] 00:01:00 PreventUserIdleDisplaySleep named: "playing"\n' : ''}${
    noDisplay ? '   pid 901(Zoom): [0x0003] 00:01:00 NoDisplaySleepAssertion named: "call"\n' : ''
  }`;

  it('summary only (older macOS output)', () => {
    expect(parsePmsetAssertions('Assertion status system-wide:\n   PreventUserIdleDisplaySleep    1\n')).toBe(true);
    expect(parsePmsetAssertions('Assertion status system-wide:\n   PreventUserIdleDisplaySleep    0\n')).toBe(false);
  });

  it('detects display sleep assertions', () => {
    expect(parsePmsetAssertions(sample(0, 0))).toBe(false);
    expect(parsePmsetAssertions(sample(1, 0))).toBe(true);
    expect(parsePmsetAssertions(sample(0, 1))).toBe(true);
    expect(parsePmsetAssertions('')).toBe(false);
  });
});

describe('linux autostart entry', () => {
  it('quotes paths with spaces', () => {
    expect(linuxAutostartEntry('/opt/Big Eyes/big-eyes')).toContain('Exec="/opt/Big Eyes/big-eyes"');
    expect(linuxAutostartEntry('/usr/bin/big-eyes')).toContain('Exec=/usr/bin/big-eyes\n');
    expect(linuxAutostartEntry('/x')).toMatch(/^\[Desktop Entry\]\nType=Application/);
  });
});
