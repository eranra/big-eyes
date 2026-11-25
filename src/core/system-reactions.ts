import { execFile } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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

/** True when the computer draws from the mains (best effort; never throws, false on any failure). */
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
    // Windows: best effort via WMIC (often unavailable); anything else: assume AC (desktops).
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
 * not to sleep — music players do this while playing (video players hold display assertions,
 * which do not count). Exported for tests.
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
export async function audioPlaying(): Promise<boolean> {
  if (process.platform !== 'darwin') return false;
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(parseAudioPlaying(stdout));
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

/**
 * Watches for new screenshots; calls `onScreenshot` at most once per 1.5 s.
 * Best effort: no folder, no reaction. Returns a stop function.
 */
export function watchScreenshots(onScreenshot: () => void): () => void {
  let stopped = false;
  let lastFire = 0;
  let watcher: { close(): void } | null = null;
  void screenshotFolder().then((folder) => {
    if (stopped || !folder) return;
    try {
      watcher = watch(folder, (_event, filename) => {
        if (!filename || !isScreenshotName(filename)) return;
        const now = Date.now();
        if (now - lastFire < 1500) return; // one reaction per shortcut press
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

function watch(folder: string, listener: (event: string, filename: string | null) => void): { close(): void } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsSync = require('node:fs') as typeof import('node:fs');
  return fsSync.watch(folder, { persistent: false }, listener);
}
