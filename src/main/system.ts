import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * macOS: true if some *other* app (video player, video call, presentation) asks the display to stay on.
 * Uses `pmset -g assertions`. `ignorePids` are our own processes: in "replace the screen saver" mode Big Eyes
 * holds such an assertion itself, and it must not block its own eyes. Other platforms always return false.
 */
export function displaySleepPrevented(ignorePids: readonly number[] = []): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(parsePmsetAssertions(stdout, ignorePids));
    });
  });
}

const DISPLAY_ASSERTIONS = /\b(PreventUserIdleDisplaySleep|NoDisplaySleepAssertion)\b/;

/**
 * Parses `pmset -g assertions`. With the per-process list, counts display assertions of processes not in
 * `ignorePids`. Without it, falls back to the system-wide summary. Exported for tests.
 */
export function parsePmsetAssertions(output: string, ignorePids: readonly number[] = []): boolean {
  const lines = output.split('\n');
  const listStart = lines.findIndex((l) => /Listed by owning process/.test(l));
  if (listStart >= 0) {
    for (const line of lines.slice(listStart + 1)) {
      const m = /^\s*pid (\d+)\(/.exec(line);
      if (!m) continue;
      if (DISPLAY_ASSERTIONS.test(line) && !ignorePids.includes(Number(m[1]))) return true;
    }
    return false;
  }
  for (const line of lines) {
    const match = /^\s*(PreventUserIdleDisplaySleep|NoDisplaySleepAssertion)\s+(\d+)/.exec(line);
    if (match && Number(match[2]) > 0) return true;
  }
  return false;
}

/** Process names of the system screen saver. macOS runs screen savers in one of these. */
const SCREEN_SAVER_PROCESSES = {
  darwin: ['ScreenSaverEngine', 'legacyScreenSaver'],
} as const;

/**
 * True when the system screen saver is running.
 * - macOS: the ScreenSaverEngine / legacyScreenSaver process exists.
 * - Windows: a `.scr` screen saver process runs.
 * - Linux: not detected (returns false); most desktops lock the screen instead, which is handled separately.
 */
export function screenSaverRunning(): Promise<boolean> {
  if (process.platform === 'darwin') {
    const running = (name: string): Promise<boolean> =>
      new Promise((r) => execFile('/usr/bin/pgrep', ['-x', name], { timeout: 2000 }, (err) => r(!err)));
    return Promise.all(SCREEN_SAVER_PROCESSES.darwin.map(running)).then((found) => found.some(Boolean));
  }
  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 4000, windowsHide: true }, (error, stdout) => {
        if (error) return resolve(false);
        resolve(/"[^"]+\.scr"/i.test(stdout));
      });
    });
  }
  return Promise.resolve(false);
}

/** Contents of the Linux autostart file. Exported for tests. */
export function linuxAutostartEntry(execPath: string): string {
  const quoted = /[\s"'\\]/.test(execPath) ? `"${execPath.replace(/(["\\])/g, '\\$1')}"` : execPath;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Big Eyes',
    'Comment=Friendly eyes that look back at you',
    `Exec=${quoted}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Linux: adds or removes ~/.config/autostart/big-eyes.desktop. */
export async function setLinuxAutostart(enabled: boolean, execPath: string): Promise<void> {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const file = path.join(configHome, 'autostart', 'big-eyes.desktop');
  if (enabled) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, linuxAutostartEntry(process.env.APPIMAGE || execPath), 'utf8');
  } else {
    await fs.rm(file, { force: true });
  }
}

/** Parses `pmset -g` output: the display sleep time in minutes (0 = never). Exported for tests. */
export function parseDisplaySleepMinutes(output: string): number | null {
  const m = /^\s*displaysleep\s+(\d+)/m.exec(output);
  return m ? Number(m[1]) : null;
}

const run = (cmd: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) =>
    execFile(cmd, args, { timeout: 3000, windowsHide: true }, (error, stdout) => resolve(error ? null : String(stdout))),
  );

/**
 * The time (seconds) after which this computer would start its screen saver, or null if it has none.
 * - macOS: the screen saver time if set; otherwise the display sleep time (the display turns off and,
 *   usually, the screen locks).
 * - Windows: the screen saver timeout, if a screen saver is on.
 * - Linux: not read (null).
 */
export async function systemScreenSaverSeconds(): Promise<number | null> {
  if (process.platform === 'darwin') {
    const saver = Number((await run('/usr/bin/defaults', ['-currentHost', 'read', 'com.apple.screensaver', 'idleTime']))?.trim());
    if (Number.isFinite(saver) && saver > 0) return saver;
    const minutes = parseDisplaySleepMinutes((await run('/usr/bin/pmset', ['-g'])) ?? '');
    return minutes && minutes > 0 ? minutes * 60 : null;
  }
  if (process.platform === 'win32') {
    const key = 'HKCU\\Control Panel\\Desktop';
    const active = await run('reg', ['query', key, '/v', 'ScreenSaveActive']);
    if (!active || !/ScreenSaveActive\s+REG_SZ\s+1/.test(active)) return null;
    const timeout = await run('reg', ['query', key, '/v', 'ScreenSaveTimeOut']);
    const m = timeout && /ScreenSaveTimeOut\s+REG_SZ\s+(\d+)/.exec(timeout);
    return m ? Number(m[1]) : null;
  }
  return null;
}
