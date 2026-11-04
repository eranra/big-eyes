import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A small log file, always on, so problems that happen while nobody watches (for example "the eyes did not
 * appear while I was away") can be looked at later.
 *
 * - macOS:   ~/Library/Logs/Big Eyes/main.log
 * - Windows: %APPDATA%\Big Eyes\logs\main.log
 * - Linux:   ~/.config/Big Eyes/logs/main.log
 *
 * Only app events are written: shows, hides and why, checks, errors. Never images or face data.
 * The file is kept under 1 MB: when it grows larger, it is renamed to main.old.log.
 */
const MAX_BYTES = 1_000_000;
let file: string | null = null;
let stream: fs.WriteStream | null = null;
let written = 0;

export function logFile(): string {
  file ??= path.join(app.getPath('logs'), 'main.log');
  return file;
}

function open(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    const f = logFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    try {
      written = fs.statSync(f).size;
    } catch {
      written = 0;
    }
    stream = fs.createWriteStream(f, { flags: 'a' });
    stream.on('error', () => (stream = null));
    return stream;
  } catch {
    return null;
  }
}

function rotate(): void {
  try {
    stream?.end();
    stream = null;
    const f = logFile();
    fs.renameSync(f, f.replace(/\.log$/, '.old.log'));
    written = 0;
  } catch {
    // Not important.
  }
}

function format(items: unknown[]): string {
  return items
    .map((i) => (typeof i === 'string' ? i : i instanceof Error ? i.message : JSON.stringify(i)))
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

/** Writes one line: local time, then the message. */
export function log(...items: unknown[]): void {
  const line = `${new Date().toISOString()} ${format(items)}\n`;
  if (written + line.length > MAX_BYTES) rotate();
  const s = open();
  if (!s) return;
  s.write(line);
  written += line.length;
}
