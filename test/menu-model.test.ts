import { describe, expect, it } from 'vitest';
import type { CameraInfo, DisplaySummary } from '../src/core/ipc';
import { defaultSettings, mergeSettings } from '../src/core/settings';
import { buildMenuModel, cameraMenu, screensMenu, type MenuNode } from '../src/main/menu-model';

const find = (nodes: MenuNode[], label: string): MenuNode => {
  const node = nodes.find((n) => n.label === label);
  if (!node) throw new Error(`menu item not found: ${label}`);
  return node;
};
const checked = (node: MenuNode): string[] => (node.submenu ?? []).filter((n) => n.checked).map((n) => n.label ?? '');

const cameras: CameraInfo[] = [
  { deviceId: 'int', label: 'MacBook Pro Camera' },
  { deviceId: 'ext', label: 'HD Pro Webcam C920' },
];
const displays: DisplaySummary[] = [
  { id: 1, label: 'Built-in Retina Display', primary: true, internal: true, width: 1728, height: 1117 },
  { id: 2, label: 'DELL U2720Q', primary: false, internal: false, width: 3840, height: 2160 },
];

describe('tray menu model', () => {
  it('marks the current presets', () => {
    const menu = buildMenuModel(defaultSettings(), cameras, displays, 'darwin');
    expect(checked(find(menu, 'Eye Size'))).toEqual(['Medium']);
    expect(checked(find(menu, 'Show After'))).toEqual(['30 seconds']);
    expect(checked(find(menu, 'Look'))).toEqual(['Classic']);
    expect(checked(find(menu, 'Eye Color'))).toEqual(['Blue']);
    expect(checked(find(menu, 'Background'))).toEqual(['Light']);
  });

  it('shows Custom when the value is not a preset', () => {
    const s = mergeSettings(defaultSettings(), { eyeSize: 1.1 });
    const size = find(buildMenuModel(s, [], [], 'darwin'), 'Eye Size');
    expect(checked(size)).toEqual(['Custom (set in Settings)']);
  });

  it('offers a Very Small size', () => {
    const size = find(buildMenuModel(defaultSettings(), [], [], 'darwin'), 'Eye Size');
    expect(size.submenu!.map((n) => n.label)).toEqual(['Very Small', 'Small', 'Medium', 'Large', 'Huge']);
    expect(find(size.submenu!, 'Very Small').action).toEqual({ kind: 'patch', patch: { eyeSize: 0.35 } });
  });

  it('menu items carry settings patches', () => {
    const size = find(buildMenuModel(defaultSettings(), [], [], 'darwin'), 'Eye Size');
    expect(find(size.submenu!, 'Large').action).toEqual({ kind: 'patch', patch: { eyeSize: 1.35 } });
  });

  it('the video option is macOS only', () => {
    const label = "Don't Show During Video";
    expect(buildMenuModel(defaultSettings(), [], [], 'darwin').some((n) => n.label === label)).toBe(true);
    expect(buildMenuModel(defaultSettings(), [], [], 'win32').some((n) => n.label === label)).toBe(false);
  });

  it('has position, blinking and closing menus', () => {
    const menu = buildMenuModel(defaultSettings(), [], [], 'darwin');
    expect(checked(find(menu, 'Position'))).toEqual(['Center']);
    expect(checked(find(menu, 'Blinking'))).toEqual(['Normal', 'Normal']);
    const closing = find(menu, 'Closing');
    expect(checked(closing)).toEqual(['Moving onto the eyes closes them']);
    expect(find(closing.submenu!, 'Looking Into the Eyes Closes Them').action).toEqual({
      kind: 'patch',
      patch: { lookToClose: true },
    });
  });

  it('has the waiting and screen saver options', () => {
    const menu = buildMenuModel(defaultSettings(), [], [], 'darwin');
    expect(find(menu, "Wait While I'm Looking at the Screen").checked).toBe(true);
    const saver = find(menu, 'Screen Saver');
    expect(checked(saver)).toEqual(['Pause the eyes during the screen saver']);
    expect(find(saver.submenu!, 'Eyes replace the screen saver').action).toEqual({ kind: 'patch', patch: { screenSaver: 'replace' } });
  });

  it('pause toggles', () => {
    const menu = buildMenuModel(mergeSettings(defaultSettings(), { paused: true }), [], [], 'linux');
    expect(find(menu, 'Paused').action).toEqual({ kind: 'patch', patch: { paused: false } });
  });
});

describe('camera menu', () => {
  it('defaults to the built-in camera', () => {
    expect(checked(cameraMenu(defaultSettings(), cameras))).toEqual(['Built-in Camera']);
  });

  it('modes and per-camera checkboxes', () => {
    const menu = cameraMenu(defaultSettings(), cameras);
    expect(find(menu.submenu!, 'All Cameras').action).toEqual({ kind: 'patch', patch: { cameras: { mode: 'all' } } });
    expect(find(menu.submenu!, 'HD Pro Webcam C920').action).toEqual({
      kind: 'patch',
      patch: { cameras: { mode: 'selected', cameras: [{ id: 'ext', label: 'HD Pro Webcam C920' }] } },
    });
  });

  it('adds a second camera and marks the main one', () => {
    const s = mergeSettings(defaultSettings(), { cameras: { mode: 'selected', cameras: [{ id: 'int', label: 'MacBook Pro Camera' }] } });
    const one = cameraMenu(s, cameras);
    const builtIn = one.submenu!.find((n) => n.label?.startsWith('MacBook Pro Camera'))!;
    expect(builtIn.checked).toBe(true);
    expect(builtIn.enabled).toBe(false); // the last camera cannot be turned off
    expect(one.submenu!.find((n) => n.label === 'HD Pro Webcam C920')!.action).toEqual({
      kind: 'patch',
      patch: {
        cameras: {
          mode: 'selected',
          cameras: [
            { id: 'int', label: 'MacBook Pro Camera' },
            { id: 'ext', label: 'HD Pro Webcam C920' },
          ],
        },
      },
    });
    const two = mergeSettings(s, {
      cameras: { mode: 'selected', cameras: [{ id: 'int', label: 'MacBook Pro Camera' }, { id: 'ext', label: 'HD Pro Webcam C920' }] },
    });
    expect(checked(cameraMenu(two, cameras))).toEqual(['MacBook Pro Camera (built-in) — main', 'HD Pro Webcam C920']);
  });

  it('keeps a saved camera that is not connected', () => {
    const s = mergeSettings(defaultSettings(), { cameras: { mode: 'selected', cameras: [{ id: 'gone', label: 'Old Cam' }] } });
    expect(checked(cameraMenu(s, cameras))).toEqual(['Old Cam (not connected)']);
  });
});

describe('screens menu', () => {
  it('built-in / all / main / per screen', () => {
    expect(checked(screensMenu(defaultSettings(), displays))).toEqual(['Built-in Screen']);
    const all = screensMenu(mergeSettings(defaultSettings(), { screens: { mode: 'all' } }), displays);
    expect(checked(all)).toEqual(['All Screens']);
    const builtIn = all.submenu!.find((n) => n.label?.includes('1728×1117'))!;
    expect(builtIn.action).toEqual({ kind: 'patch', patch: { screens: { mode: 'selected', ids: [1] } } });
  });

  it('the last selected screen cannot be turned off', () => {
    const s = mergeSettings(defaultSettings(), { screens: { mode: 'selected', ids: [2] } });
    const dell = screensMenu(s, displays).submenu!.find((n) => n.label?.startsWith('DELL'))!;
    expect(dell.checked).toBe(true);
    expect(dell.enabled).toBe(false);
  });

  it('no per-screen items with one screen', () => {
    expect(screensMenu(defaultSettings(), displays.slice(0, 1)).submenu).toHaveLength(3);
  });
});
