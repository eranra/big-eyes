import { describe, expect, it } from 'vitest';
import { AfterEyesTimer } from '../src/core/after-eyes';
import { afterEyesSeconds, defaultSettings, mergeSettings, normalizeSettings } from '../src/core/settings';
import { afterEyesMenu, screenSaverMenu, type MenuNode } from '../src/main/menu-model';
import { expandWindowsVars, parseRegString } from '../src/main/system';

const replace = mergeSettings(defaultSettings(), { screenSaver: 'replace' });
const find = (nodes: MenuNode[], label: string): MenuNode => {
  const node = nodes.find((n) => n.label === label);
  if (!node) throw new Error(`no menu item ${label}`);
  return node;
};

describe('after-the-eyes settings', () => {
  it('defaults to the real screen saver 5 minutes after the screen saver time', () => {
    const d = defaultSettings();
    expect(d.afterEyes).toBe('screensaver');
    expect(d.afterEyesMinutes).toBe(5);
  });

  it('accepts any whole number of minutes from 0 to 600, and only known actions', () => {
    expect(normalizeSettings({ afterEyesMinutes: 7.4 }).afterEyesMinutes).toBe(7);
    expect(normalizeSettings({ afterEyesMinutes: 9999 }).afterEyesMinutes).toBe(600);
    expect(normalizeSettings({ afterEyesMinutes: -3 }).afterEyesMinutes).toBe(0);
    expect(normalizeSettings({ afterEyes: 'lock' }).afterEyes).toBe('lock');
    expect(normalizeSettings({ afterEyes: 'shutdown' }).afterEyes).toBe('screensaver');
  });

  it('happens at the screen saver time plus the wait, only in replace mode', () => {
    // System screen saver time 10 min, wait 5 min.
    expect(afterEyesSeconds(replace, 600)).toBe(900);
    expect(afterEyesSeconds(mergeSettings(replace, { afterEyesMinutes: 0 }), 600)).toBe(600);
    // Own screen saver time (15 min) wins over the system's.
    expect(afterEyesSeconds(mergeSettings(replace, { screenSaverMinutes: 15, afterEyesMinutes: 30 }), 600)).toBe(2700);
    expect(afterEyesSeconds(defaultSettings(), 600)).toBeNull(); // "pause" mode: the system does it
    expect(afterEyesSeconds(mergeSettings(replace, { afterEyes: 'none' }), 600)).toBeNull();
    expect(afterEyesSeconds(mergeSettings(replace, { paused: true }), 600)).toBeNull();
  });
});

describe('AfterEyesTimer', () => {
  it('is due once the idle time reaches the time, and stays out of the way after the hand-off', () => {
    const t = new AfterEyesTimer();
    expect(t.update(100, 900)).toBeNull();
    expect(t.update(899.9, 900)).toBeNull();
    expect(t.update(900, 900)).toBe('due');
    expect(t.update(900.1, 900)).toBe('due'); // until handOff() is called
    t.handOff();
    expect(t.handedOff).toBe(true);
    expect(t.update(1200, 900)).toBeNull();
    expect(t.update(5000, 900)).toBeNull();
  });

  it('comes back on new input, once, and starts the next idle stretch', () => {
    const t = new AfterEyesTimer();
    t.update(900, 900);
    t.handOff();
    t.update(950, 900);
    expect(t.update(0.2, 900)).toBe('back');
    expect(t.handedOff).toBe(false);
    expect(t.update(0.3, 900)).toBeNull();
    expect(t.update(901, 900)).toBe('due');
  });

  it('sees input when the idle time goes down, even if it is not near zero', () => {
    const t = new AfterEyesTimer();
    t.update(1000, 900);
    t.handOff();
    t.update(1001, 900);
    expect(t.update(3, 900)).toBe('back');
  });

  it('is never due without a time, and reset() ends the hand-off', () => {
    const t = new AfterEyesTimer();
    expect(t.update(99999, null)).toBeNull();
    t.handOff();
    t.reset();
    expect(t.handedOff).toBe(false);
  });
});

describe('After the Eyes menu', () => {
  it('lists the actions and the waits, with the current ones checked', () => {
    const menu = afterEyesMenu(mergeSettings(replace, { afterEyes: 'lock', afterEyesMinutes: 10 }));
    expect(find(menu.submenu!, 'Lock the Screen').checked).toBe(true);
    expect(find(menu.submenu!, 'Keep the Eyes').checked).toBe(false);
    expect(find(menu.submenu!, '10 minutes').checked).toBe(true);
    expect(find(menu.submenu!, 'Right Away').enabled).not.toBe(false);
  });

  it('shows a custom wait from Settings as checked, and disables the waits for "Keep the Eyes"', () => {
    const custom = afterEyesMenu(mergeSettings(replace, { afterEyesMinutes: 7 }));
    expect(find(custom.submenu!, 'Custom (set in Settings)').checked).toBe(true);
    const keep = afterEyesMenu(mergeSettings(replace, { afterEyes: 'none' }));
    expect(find(keep.submenu!, '5 minutes').enabled).toBe(false);
  });

  it('is enabled only in replace mode', () => {
    expect(find(screenSaverMenu(replace).submenu!, 'After the Eyes').enabled).toBe(true);
    expect(find(screenSaverMenu(defaultSettings()).submenu!, 'After the Eyes').enabled).toBe(false);
  });
});

describe('Windows screen saver file', () => {
  it('reads SCRNSAVE.EXE, also with spaces in the path', () => {
    const out = [
      'HKEY_CURRENT_USER\\Control Panel\\Desktop',
      '    ScreenSaveActive    REG_SZ    1',
      '    SCRNSAVE.EXE    REG_SZ    C:\\Program Files\\My Savers\\Aurora.scr',
      '    ScreenSaveTimeOut    REG_SZ    600',
    ].join('\r\n');
    expect(parseRegString(out, 'SCRNSAVE.EXE')).toBe('C:\\Program Files\\My Savers\\Aurora.scr');
    expect(parseRegString('    SCRNSAVE.EXE    REG_EXPAND_SZ    %SystemRoot%\\system32\\Bubbles.scr', 'SCRNSAVE.EXE')).toBe(
      '%SystemRoot%\\system32\\Bubbles.scr',
    );
    expect(parseRegString(out, 'Wallpaper')).toBeNull();
    expect(parseRegString(null, 'SCRNSAVE.EXE')).toBeNull();
  });

  it('expands %SystemRoot% and similar parts, ignoring case', () => {
    const env = { SystemRoot: 'C:\\Windows' };
    expect(expandWindowsVars('%SystemRoot%\\system32\\Bubbles.scr', env)).toBe('C:\\Windows\\system32\\Bubbles.scr');
    expect(expandWindowsVars('%SYSTEMROOT%\\x.scr', env)).toBe('C:\\Windows\\x.scr');
    expect(expandWindowsVars('%Unknown%\\x.scr', env)).toBe('%Unknown%\\x.scr');
  });
});
