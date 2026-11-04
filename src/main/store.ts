import { promises as fs } from 'node:fs';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { defaultSettings, mergeSettings, normalizeSettings, type Settings } from '../core/settings';

/**
 * Saves settings as JSON in the app's user data folder:
 * - macOS:   ~/Library/Application Support/Big Eyes/settings.json
 * - Windows: %APPDATA%\Big Eyes\settings.json
 * - Linux:   ~/.config/Big Eyes/settings.json
 *
 * Writes go to a temporary file first and are then renamed, so a crash never leaves a half-written file.
 * A broken file is renamed to `settings.json.broken` and defaults are used.
 */
export class SettingsStore {
  readonly file: string;
  private current: Settings;
  private listeners: Array<(settings: Settings) => void> = [];
  private writing: Promise<void> = Promise.resolve();

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json');
    this.current = this.loadSync();
  }

  get(): Settings {
    return this.current;
  }

  /** Merges a partial update, validates it, saves it, and notifies listeners. Returns the new settings. */
  update(patch: unknown): Settings {
    const next = mergeSettings(this.current, patch);
    return this.replace(next);
  }

  reset(): Settings {
    return this.replace(defaultSettings());
  }

  onChange(listener: (settings: Settings) => void): void {
    this.listeners.push(listener);
  }

  /** Resolves when all pending writes are done. */
  flush(): Promise<void> {
    return this.writing;
  }

  private replace(next: Settings): Settings {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return this.current;
    this.current = next;
    const data = JSON.stringify(next, null, 2) + '\n';
    this.writing = this.writing.then(() => this.write(data)).catch((error: unknown) => {
      console.error('[big-eyes] could not save settings:', error);
    });
    for (const listener of this.listeners) listener(next);
    return next;
  }

  private async write(data: string): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, data, 'utf8');
    await fs.rename(temp, this.file);
  }

  private loadSync(): Settings {
    let text: string;
    try {
      text = fsSync.readFileSync(this.file, 'utf8');
    } catch {
      return defaultSettings();
    }
    try {
      return normalizeSettings(JSON.parse(text));
    } catch {
      try {
        fsSync.renameSync(this.file, `${this.file}.broken`);
      } catch {
        // Ignore: we fall back to defaults either way.
      }
      return defaultSettings();
    }
  }
}
