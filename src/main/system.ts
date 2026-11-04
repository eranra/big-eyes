import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * macOS: true if some app (video player, video call, presentation) asks the display to stay on.
 * Uses `pmset -g assertions`. Other platforms always return false.
 */
export function displaySleepPrevented(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', ['-g', 'assertions'], { timeout: 3000 }, (error, stdout) => {
      if (error) return resolve(false);
      resolve(parsePmsetAssertions(stdout));
    });
  });
}

/** Parses the summary block of `pmset -g assertions`. Exported for tests. */
export function parsePmsetAssertions(output: string): boolean {
  for (const line of output.split('\n')) {
    const match = /^\s*(PreventUserIdleDisplaySleep|NoDisplaySleepAssertion)\s+(\d+)/.exec(line);
    if (match && Number(match[2]) > 0) return true;
  }
  return false;
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
