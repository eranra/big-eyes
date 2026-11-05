import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { parseInputKinds, type InputKinds } from '../core/activity';

/**
 * macOS: runs the small idle helper (native/macos/idle-helper.swift), which prints the seconds since the last key,
 * click, scroll and mouse move, 10 times per second. Big Eyes uses these to never mistake typing for idleness, and
 * to ignore tiny mouse wobbles. On other systems, or if the helper is missing, `latest()` returns null.
 */
export class InputKinds$ {
  private child: ChildProcess | null = null;
  private last: { at: number; kinds: InputKinds } | null = null;
  private buffer = '';
  private restarts = 0;

  constructor(private readonly log: (...items: unknown[]) => void) {}

  static helperPath(): string {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'idle-helper')
      : path.join(__dirname, '..', 'native', 'idle-helper');
  }

  start(): void {
    if (process.platform !== 'darwin' || this.child) return;
    const file = InputKinds$.helperPath();
    if (!existsSync(file)) {
      this.log(`idle helper not found (${file}); using the combined idle counter`);
      return;
    }
    const child = spawn(file, ['0.1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      this.buffer += chunk;
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() ?? '';
      const kinds = parseInputKinds(lines[lines.length - 1] ?? '');
      if (kinds) this.last = { at: performance.now() / 1000, kinds };
    });
    child.on('exit', (code) => {
      this.child = null;
      this.last = null;
      if (this.restarts++ < 3) {
        this.log(`idle helper stopped (code ${code}); restarting`);
        setTimeout(() => this.start(), 2000);
      } else {
        this.log('idle helper keeps stopping; using the combined idle counter');
      }
    });
    this.log('idle helper started');
  }

  /** The latest counters, or null when none arrived in the last second. */
  latest(): InputKinds | null {
    if (!this.last) return null;
    const age = performance.now() / 1000 - this.last.at;
    if (age > 1) return null;
    const k = this.last.kinds;
    return { key: k.key + age, click: k.click + age, scroll: k.scroll + age, move: k.move + age };
  }

  stop(): void {
    this.restarts = 99;
    this.child?.kill();
    this.child = null;
  }
}
