import { execFile, spawn } from 'node:child_process';
import { existsSync, promises as fs, watch as fsWatch } from 'node:fs';
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

/** Where a screen saver time was found. Shown in the log and in Settings. */
export type SaverTimeSource =
  | 'managed policy'
  | 'screen saver setting'
  | 'display sleep'
  | 'group policy'
  | 'monitor off'
  | 'GNOME'
  | 'KDE';

export interface SaverTime {
  seconds: number;
  source: SaverTimeSource;
}

/** Reads `idleTime` from a plist file with plutil. Returns seconds, or null when it is missing or 0. */
async function plistIdleTime(file: string): Promise<number | null> {
  const out = await run('/usr/bin/plutil', ['-extract', 'idleTime', 'raw', '-o', '-', file]);
  const n = Number(out?.trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** macOS: the files that hold the screen saver time. Watched for changes. */
export function macSaverFiles(user = os.userInfo().username): string[] {
  return [
    `/Library/Managed Preferences/${user}/com.apple.screensaver.plist`,
    '/Library/Managed Preferences/com.apple.screensaver.plist',
    path.join(os.homedir(), 'Library/Preferences/ByHost'),
  ];
}

/** Parses `reg query` output for one REG_SZ or REG_DWORD value. Exported for tests. */
export function parseRegValue(output: string | null, name: string): string | null {
  if (!output) return null;
  const m = new RegExp(`${name}\\s+REG_(?:SZ|DWORD)\\s+(\\S+)`, 'i').exec(output);
  if (!m) return null;
  return m[1]!.startsWith('0x') ? String(parseInt(m[1]!, 16)) : m[1]!;
}

/** Parses `powercfg /q` output for the "Turn off display after" AC value, in seconds. Exported for tests. */
export function parsePowercfgDisplayTimeout(output: string | null): number | null {
  if (!output) return null;
  const m = /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(output);
  const n = m ? parseInt(m[1]!, 16) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parses `[Daemon] Timeout=10` (minutes) from kscreenlockerrc. Exported for tests. */
export function parseKdeTimeout(text: string | null): number | null {
  if (!text) return null;
  const m = /^\s*Timeout\s*=\s*(\d+)/m.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n * 60 : null;
}

/** Parses `gsettings get org.gnome.desktop.session idle-delay` ("uint32 600"). Exported for tests. */
export function parseGnomeIdleDelay(text: string | null): number | null {
  const m = text && /(\d+)\s*$/.exec(text.trim());
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : null;
}

/**
 * The time after which this computer would start its screen saver, and where it was found. Null if none.
 *
 * - macOS: managed policy (IT profile) for this user, then for all users, then the user's own screen saver
 *   setting, then the display sleep time.
 * - Windows: group policy, then the user's screen saver (if it is on), then the "turn off display" time.
 * - Linux: GNOME idle delay, then the KDE screen locker timeout.
 */
export async function systemScreenSaverTime(): Promise<SaverTime | null> {
  if (process.platform === 'darwin') {
    const [userManaged, allManaged] = macSaverFiles();
    for (const file of [userManaged!, allManaged!]) {
      const seconds = await plistIdleTime(file);
      if (seconds) return { seconds, source: 'managed policy' };
    }
    const own = Number((await run('/usr/bin/defaults', ['-currentHost', 'read', 'com.apple.screensaver', 'idleTime']))?.trim());
    if (Number.isFinite(own) && own > 0) return { seconds: own, source: 'screen saver setting' };
    const minutes = parseDisplaySleepMinutes((await run('/usr/bin/pmset', ['-g'])) ?? '');
    return minutes && minutes > 0 ? { seconds: minutes * 60, source: 'display sleep' } : null;
  }
  if (process.platform === 'win32') {
    const policy = await run('reg', ['query', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop']);
    const policyTimeout = Number(parseRegValue(policy, 'ScreenSaveTimeOut'));
    if (policyTimeout > 0 && parseRegValue(policy, 'ScreenSaveActive') !== '0') return { seconds: policyTimeout, source: 'group policy' };
    const desktop = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop']);
    const timeout = Number(parseRegValue(desktop, 'ScreenSaveTimeOut'));
    if (parseRegValue(desktop, 'ScreenSaveActive') === '1' && timeout > 0) return { seconds: timeout, source: 'screen saver setting' };
    const display = parsePowercfgDisplayTimeout(await run('powercfg', ['/q', 'SCHEME_CURRENT', 'SUB_VIDEO', 'VIDEOIDLE']));
    return display ? { seconds: display, source: 'monitor off' } : null;
  }
  if (process.platform === 'linux') {
    const gnome = parseGnomeIdleDelay(await run('gsettings', ['get', 'org.gnome.desktop.session', 'idle-delay']));
    if (gnome) return { seconds: gnome, source: 'GNOME' };
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const kde = parseKdeTimeout(await fs.readFile(path.join(configHome, 'kscreenlockerrc'), 'utf8').catch(() => null));
    if (kde) return { seconds: kde, source: 'KDE' };
  }
  return null;
}

/** Seconds only, for callers that do not need the source. */
export async function systemScreenSaverSeconds(): Promise<number | null> {
  return (await systemScreenSaverTime())?.seconds ?? null;
}

/** Parses one REG_SZ value that may contain spaces (a file path) from `reg query` output. Exported for tests. */
export function parseRegString(output: string | null, name: string): string | null {
  if (!output) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^\\s*${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, 'im').exec(output);
  return m ? m[1]! : null;
}

/** Expands %NAME% parts of a Windows path from the environment (unknown names stay as they are). Exported for tests. */
export function expandWindowsVars(value: string, env: NodeJS.ProcessEnv = process.env): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key]! : whole;
  });
}

/** Starts a program that keeps running (a screen saver), without waiting for it. */
function launch(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** How the system action was done (for the log), or null when it failed. */
export type SystemActionResult = string | null;

/**
 * Locks the screen.
 * - macOS: the idle helper's `--lock` command (the same lock as Control-Command-Q). Without the helper, it starts
 *   the screen saver instead, which locks only if the system asks for a password after the screen saver.
 * - Windows: LockWorkStation.
 * - Linux: `loginctl lock-session`, else `xdg-screensaver lock`.
 */
export async function lockScreen(macHelper: string | null): Promise<SystemActionResult> {
  if (process.platform === 'darwin') {
    if (macHelper && existsSync(macHelper) && (await run(macHelper, ['--lock'])) !== null) return 'macOS lock';
    return (await startScreenSaver()) ? 'screen saver (the lock function was not available)' : null;
  }
  if (process.platform === 'win32') {
    return (await run('rundll32.exe', ['user32.dll,LockWorkStation'])) !== null ? 'LockWorkStation' : null;
  }
  if ((await run('loginctl', ['lock-session'])) !== null) return 'loginctl lock-session';
  if ((await run('xdg-screensaver', ['lock'])) !== null) return 'xdg-screensaver lock';
  return null;
}

/**
 * Starts the real system screen saver.
 * - macOS: ScreenSaverEngine.
 * - Windows: the screen saver chosen in the settings (or by group policy); without one, it locks the screen.
 * - Linux: `xdg-screensaver activate`; if that fails, it locks the screen.
 */
export async function startScreenSaver(): Promise<SystemActionResult> {
  if (process.platform === 'darwin') {
    return (await run('/usr/bin/open', ['-a', 'ScreenSaverEngine'])) !== null ? 'ScreenSaverEngine' : null;
  }
  if (process.platform === 'win32') {
    const policy = await run('reg', ['query', 'HKCU\\Software\\Policies\\Microsoft\\Windows\\Control Panel\\Desktop']);
    const desktop = await run('reg', ['query', 'HKCU\\Control Panel\\Desktop']);
    const raw = parseRegString(policy, 'SCRNSAVE.EXE') ?? parseRegString(desktop, 'SCRNSAVE.EXE');
    const file = raw ? expandWindowsVars(raw) : null;
    if (file && (await launch(file, ['/s']))) return path.basename(file);
    const locked = await lockScreen(null);
    return locked ? `${locked} (no screen saver is set)` : null;
  }
  if ((await run('xdg-screensaver', ['activate'])) !== null) return 'xdg-screensaver activate';
  const locked = await lockScreen(null);
  return locked ? `${locked} (the screen saver could not start)` : null;
}

// ---- System reactions: power, audio, screenshots ----------------------------------------------

/**
 * Parses power-source output. macOS: `pmset -g batt` ("Now drawing from 'AC Power'" or 'Battery Power').
 * Linux: the contents of an adapter's `online` file under the power-supply sysfs ("1" = on AC).
 * Anything else: false. Exported for tests.
 */
export function parsePowerSource(output: string | null): boolean {
  if (!output) return false;
  if (/Now drawing from 'AC Power'/.test(output)) return true;
  if (/Now drawing from 'Battery Power'/.test(output)) return false;
  return /^1\s*$/.test(output.trim());
}

/** True when the computer draws from the mains (never throws; false on any failure). */
export async function isACPower(): Promise<boolean> {
  try {
    if (process.platform === 'darwin') {
      return await new Promise<boolean>((resolve) => {
        execFile('/usr/bin/pmset', ['-g', 'batt'], { timeout: 3000 }, (error, stdout) => {
          resolve(!error && parsePowerSource(stdout));
        });
      });
    }
    if (process.platform === 'linux') {
      const dirs = await fs.readdir('/sys/class/power_supply').catch(() => [] as string[]);
      for (const d of dirs) {
        if (!d.startsWith('A')) continue;
        const online = await fs.readFile(`/sys/class/power_supply/${d}/online`, 'utf8').catch(() => '');
        if (parsePowerSource(online)) return true;
      }
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      execFile('wmic', ['path', 'Win32_Battery', 'get', 'BatteryStatus'], { timeout: 3000 }, (error, stdout) => {
        resolve(!error && /\b2\b/.test(stdout ?? ''));
      });
    });
  } catch {
    return false;
  }
}

/**
 * Parses `pmset -g assertions` for audio: a NoIdleSleepAssertion means some app asks the system
 * not to sleep — music players do this while playing, and so do some non-audio processes
 * (downloads, WebRTC calls). Best effort: true means "probably music". Video players hold
 * display assertions too, which we do not count (the eyes stay away during video anyway).
 * Exported for tests.
 */
export function parseAudioPlaying(output: string | null): boolean {
  if (!output) return false;
  const lines = output.split('\n');
  const listStart = lines.findIndex((l) => /Listed by owning process/.test(l));
  if (listStart >= 0) {
    for (const line of lines.slice(listStart)) {
      if (/pid \d+/.test(line) && /NoIdleSleepAssertion/.test(line)) return true;
    }
    return false;
  }
  return /NoIdleSleepAssertion/.test(output);
}

/** True while another app plays audio (macOS only; best effort, never throws). */
export async function audioPlaying(ignorePids: readonly number[] = []): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(false);
      // The eyes bob only when the only reason is music, not our own display-sleep blocker.
      resolve(parseAudioPlaying(stdout) && !parsePmsetAssertions(stdout, ignorePids));
    });
  });
}

/** True for the file names macOS and Windows give screenshots. Exported for tests. */
export function isScreenshotName(name: string): boolean {
  return /^(Screenshot|Screen Shot) .+\.(png|jpg|jpeg)$/i.test(name);
}

/** The folder screenshots land in (macOS setting, else Desktop; Windows Pictures; else null). */
export async function screenshotFolder(): Promise<string | null> {
  try {
    if (process.platform === 'darwin') {
      const dir = await new Promise<string | null>((resolve) => {
        execFile('/usr/bin/defaults', ['read', 'com.apple.screencapture', 'location'], { timeout: 2000 }, (error, stdout) => {
          resolve(error ? null : stdout.trim().replace(/^~/, os.homedir()));
        });
      });
      const folder = dir || path.join(os.homedir(), 'Desktop');
      return existsSync(folder) ? folder : null;
    }
    if (process.platform === 'win32') {
      const folder = path.join(os.homedir(), 'Pictures', 'Screenshots');
      return existsSync(folder) ? folder : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Watches for new screenshots; calls `onScreenshot` at most once per 1.5 s. Returns a stop function. */
export function watchScreenshots(onScreenshot: () => void): () => void {
  let stopped = false;
  let lastFire = 0;
  let watcher: { close(): void } | null = null;
  void screenshotFolder().then((folder) => {
    if (stopped || !folder) return;
    try {
      watcher = fsWatch(folder, { persistent: false }, (_event, filename) => {
        if (!filename || !isScreenshotName(filename)) return;
        const now = Date.now();
        if (now - lastFire < 1500) return;
        lastFire = now;
        onScreenshot();
      });
    } catch {
      // Watching is best effort: no folder access, no reaction.
    }
  });
  return () => {
    stopped = true;
    watcher?.close();
  };
}
