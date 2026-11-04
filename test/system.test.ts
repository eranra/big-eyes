import { describe, expect, it } from 'vitest';
import {
  linuxAutostartEntry,
  parseDisplaySleepMinutes,
  parseGnomeIdleDelay,
  parseKdeTimeout,
  parsePmsetAssertions,
  parsePowercfgDisplayTimeout,
  parseRegValue,
} from '../src/main/system';

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

describe('display sleep time', () => {
  it('reads pmset -g, also while an app prevents display sleep', () => {
    expect(parseDisplaySleepMinutes(' disksleep 10\n displaysleep         60 (display sleep prevented by Big Eyes)\n')).toBe(60);
    expect(parseDisplaySleepMinutes(' displaysleep 0\n')).toBe(0);
    expect(parseDisplaySleepMinutes('')).toBeNull();
  });
});

describe('screen saver time on Windows', () => {
  const desktop = `
HKEY_CURRENT_USER\\Control Panel\\Desktop
    ActiveWndTrackTimeout    REG_DWORD    0x0
    ScreenSaveActive    REG_SZ    1
    ScreenSaveTimeOut    REG_SZ    600
    SCRNSAVE.EXE    REG_SZ    C:\\Windows\\system32\\Mystify.scr
`;
  it('reads the screen saver values', () => {
    expect(parseRegValue(desktop, 'ScreenSaveActive')).toBe('1');
    expect(parseRegValue(desktop, 'ScreenSaveTimeOut')).toBe('600');
    expect(parseRegValue(desktop, 'Missing')).toBeNull();
    expect(parseRegValue(null, 'ScreenSaveTimeOut')).toBeNull();
    expect(parseRegValue('    ScreenSaveTimeOut    REG_DWORD    0x384\n', 'ScreenSaveTimeOut')).toBe('900');
  });

  it('reads the "turn off display" time from powercfg', () => {
    const out = `Power Setting GUID: 3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e  (Turn off display after)
      Minimum Possible Setting: 0x00000000
      Current AC Power Setting Index: 0x00000384
      Current DC Power Setting Index: 0x0000012c`;
    expect(parsePowercfgDisplayTimeout(out)).toBe(900);
    expect(parsePowercfgDisplayTimeout('Current AC Power Setting Index: 0x00000000')).toBeNull();
  });
});

describe('screen saver time on Linux', () => {
  it('GNOME idle delay', () => {
    expect(parseGnomeIdleDelay('uint32 300\n')).toBe(300);
    expect(parseGnomeIdleDelay('uint32 0')).toBeNull();
    expect(parseGnomeIdleDelay(null)).toBeNull();
  });

  it('KDE screen locker timeout (minutes)', () => {
    expect(parseKdeTimeout('[Daemon]\nAutolock=true\nTimeout=10\n')).toBe(600);
    expect(parseKdeTimeout('[Daemon]\nAutolock=false\n')).toBeNull();
  });
});
