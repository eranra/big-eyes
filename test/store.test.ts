import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '../src/core/settings';
import { SettingsStore } from '../src/main/store';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'big-eyes-test-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('starts with defaults when there is no file', () => {
    expect(new SettingsStore(tempDir()).get()).toEqual(defaultSettings());
  });

  it('saves updates and loads them again', async () => {
    const dir = tempDir();
    const store = new SettingsStore(dir);
    store.update({ eyeSize: 1.35, screens: { mode: 'primary' }, cameras: { mode: 'all' } });
    await store.flush();
    const saved = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    expect(saved.eyeSize).toBe(1.35);
    const again = new SettingsStore(dir);
    expect(again.get().screens).toEqual({ mode: 'primary' });
    expect(again.get().cameras).toEqual({ mode: 'all' });
  });

  it('notifies listeners only on real changes', () => {
    const store = new SettingsStore(tempDir());
    let calls = 0;
    store.onChange(() => calls++);
    store.update({ eyeSize: 1.35 });
    store.update({ eyeSize: 1.35 });
    store.update({ nonsense: 1 });
    expect(calls).toBe(1);
  });

  it('moves a broken file aside and uses defaults', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(new SettingsStore(dir).get()).toEqual(defaultSettings());
    expect(existsSync(join(dir, 'settings.json.broken'))).toBe(true);
  });

  it('validates values from the file', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ eyeSize: 50, idleTimeout: -3 }));
    const s = new SettingsStore(dir).get();
    expect(s.eyeSize).toBe(2.5);
    expect(s.idleTimeout).toBe(5);
  });

  it('reset returns to defaults', async () => {
    const store = new SettingsStore(tempDir());
    store.update({ eyeSize: 2 });
    expect(store.reset()).toEqual(defaultSettings());
    await store.flush();
  });
});
