import type { CameraInfo, DisplaySummary } from '../core/ipc';
import { isBuiltInCamera } from '../core/camera';
import {
  BLINK_RATE_PRESETS,
  BLINK_SPEED_PRESETS,
  EYE_SIZE_PRESETS,
  IDLE_PRESETS,
  IRIS_PRESETS,
  LOOK_TO_CLOSE_PRESETS,
  matchingTheme,
  MOUSE_RULES,
  POSITIONS,
  THEMES,
  type Settings,
} from '../core/settings';

/**
 * A plain description of the tray menu. Kept free of Electron types so it can be unit tested.
 * `main.ts` turns it into an Electron `Menu`.
 */
export type MenuAction =
  | { kind: 'patch'; patch: Record<string, unknown> }
  | { kind: 'command'; command: 'show' | 'calibrate' | 'settings' | 'quit' | 'refreshCameras' };

export interface MenuNode {
  label?: string;
  type?: 'normal' | 'separator' | 'checkbox' | 'radio' | 'submenu';
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
  action?: MenuAction;
  submenu?: MenuNode[];
}

const patch = (p: Record<string, unknown>): MenuAction => ({ kind: 'patch', patch: p });
const command = (c: Extract<MenuAction, { kind: 'command' }>['command']): MenuAction => ({ kind: 'command', command: c });
const separator: MenuNode = { type: 'separator' };

export const BACKGROUND_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'None (see-through)', value: 0 },
  { label: 'Light', value: 0.35 },
  { label: 'Medium', value: 0.6 },
  { label: 'Dark', value: 0.85 },
];

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** Builds a radio submenu from presets. Adds a "Custom" entry when the current value is not a preset. */
function presetMenu<T>(
  label: string,
  presets: ReadonlyArray<{ label: string; value: T }>,
  current: T,
  same: (a: T, b: T) => boolean,
  toPatch: (value: T) => Record<string, unknown>,
): MenuNode {
  const items: MenuNode[] = presets.map((p) => ({
    label: p.label,
    type: 'radio',
    checked: same(p.value, current),
    action: patch(toPatch(p.value)),
  }));
  if (!presets.some((p) => same(p.value, current))) {
    items.push({ label: 'Custom (set in Settings)', type: 'radio', checked: true, enabled: false });
  }
  return { label, type: 'submenu', submenu: items };
}

export function cameraMenu(settings: Settings, cameras: readonly CameraInfo[]): MenuNode {
  const automatic = settings.cameraId === null && settings.cameraLabel === null;
  const known = cameras.some((c) => c.deviceId === settings.cameraId || c.label === settings.cameraLabel);
  const items: MenuNode[] = [
    {
      label: 'Built-in Camera',
      type: 'radio',
      checked: automatic && settings.cameraKind === 'builtin',
      action: patch({ cameraKind: 'builtin', cameraId: null, cameraLabel: null }),
    },
    {
      label: 'System Default',
      type: 'radio',
      checked: automatic && settings.cameraKind === 'default',
      action: patch({ cameraKind: 'default', cameraId: null, cameraLabel: null }),
    },
  ];
  if (cameras.length) items.push(separator);
  for (const camera of cameras) {
    items.push({
      label: `${camera.label || 'Camera'}${isBuiltInCamera(camera.label) ? ' (built-in)' : ''}`,
      type: 'radio',
      checked: !automatic && (camera.deviceId === settings.cameraId || camera.label === settings.cameraLabel),
      action: patch({ cameraId: camera.deviceId, cameraLabel: camera.label }),
    });
  }
  if (!automatic && !known) {
    items.push({
      label: `${settings.cameraLabel ?? 'Saved camera'} (not connected)`,
      type: 'radio',
      checked: true,
      enabled: false,
    });
  }
  items.push(separator, { label: 'Refresh Camera List', action: command('refreshCameras') });
  return { label: 'Camera', type: 'submenu', submenu: items };
}

export function screensMenu(settings: Settings, displays: readonly DisplaySummary[]): MenuNode {
  const choice = settings.screens;
  const items: MenuNode[] = [
    {
      label: displays.some((d) => d.internal) ? 'Built-in Screen' : 'Built-in Screen (none, using main)',
      type: 'radio',
      checked: choice.mode === 'builtin',
      action: patch({ screens: { mode: 'builtin' } }),
    },
    { label: 'All Screens', type: 'radio', checked: choice.mode === 'all', action: patch({ screens: { mode: 'all' } }) },
    {
      label: 'Main Screen Only',
      type: 'radio',
      checked: choice.mode === 'primary',
      action: patch({ screens: { mode: 'primary' } }),
    },
  ];
  if (displays.length > 1) {
    items.push(separator);
    const selected = choice.mode === 'selected' ? choice.ids : [];
    for (const display of displays) {
      const isOn = selected.includes(display.id);
      // Toggling a screen switches to "selected" mode. The last selected screen cannot be turned off.
      const nextIds = isOn ? selected.filter((id) => id !== display.id) : [...selected, display.id];
      items.push({
        label: `${display.label}${display.internal ? ' (built-in)' : display.primary ? ' (main)' : ''} — ${display.width}×${display.height}`,
        type: 'checkbox',
        checked: isOn,
        enabled: !(isOn && selected.length === 1),
        action: patch({ screens: { mode: 'selected', ids: nextIds } }),
      });
    }
  }
  return { label: 'Screens', type: 'submenu', submenu: items };
}

export function blinkMenu(settings: Settings): MenuNode {
  const rate = presetMenu('', BLINK_RATE_PRESETS, settings.blink.rate, near, (v) => ({ blink: { rate: v } }));
  const speed = presetMenu('', BLINK_SPEED_PRESETS, settings.blink.speed, near, (v) => ({ blink: { speed: v } }));
  return {
    label: 'Blinking',
    type: 'submenu',
    submenu: [
      { label: 'How Often', enabled: false },
      ...rate.submenu!,
      separator,
      { label: 'How Fast', enabled: false },
      ...speed.submenu!,
    ],
  };
}

/** What closes the eyes: mouse rule and look-to-close. Key presses and clicks always close them. */
export function closingMenu(settings: Settings): MenuNode {
  const items: MenuNode[] = MOUSE_RULES.map((r) => ({
    label: r.label,
    type: 'radio',
    checked: r.value === settings.mouseRule,
    action: patch({ mouseRule: r.value }),
  }));
  items.push(separator, {
    label: 'Looking Into the Eyes Closes Them',
    type: 'checkbox',
    checked: settings.lookToClose,
    action: patch({ lookToClose: !settings.lookToClose }),
  });
  const after = presetMenu('After', LOOK_TO_CLOSE_PRESETS, settings.lookToCloseSeconds, near, (v) => ({
    lookToCloseSeconds: v,
    lookToClose: true,
  }));
  items.push({ ...after, label: 'Look Time', enabled: settings.lookToClose });
  items.push({ label: 'A key press or click always closes them', enabled: false });
  return { label: 'Closing', type: 'submenu', submenu: items };
}

export function themeMenu(settings: Settings): MenuNode {
  const current = matchingTheme(settings);
  const items: MenuNode[] = THEMES.map((t) => ({
    label: t.label,
    type: 'radio',
    checked: t.id === current,
    action: patch({ irisColor: t.irisColor, look: t.look }),
  }));
  if (current === null) items.push({ label: 'Custom (set in Settings)', type: 'radio', checked: true, enabled: false });
  return { label: 'Look', type: 'submenu', submenu: items };
}

const toggle = (label: string, checked: boolean, key: keyof Settings): MenuNode => ({
  label,
  type: 'checkbox',
  checked,
  action: patch({ [key]: !checked }),
});

export function buildMenuModel(
  settings: Settings,
  cameras: readonly CameraInfo[],
  displays: readonly DisplaySummary[],
  platform: NodeJS.Platform = process.platform,
): MenuNode[] {
  const items: MenuNode[] = [
    { label: 'Show Eyes Now', accelerator: 'CommandOrControl+E', action: command('show') },
    { label: 'Calibrate Eye Contact…', action: command('calibrate') },
    separator,
    presetMenu('Eye Size', EYE_SIZE_PRESETS, settings.eyeSize, near, (v) => ({ eyeSize: v })),
    presetMenu('Show After', IDLE_PRESETS, settings.idleTimeout, near, (v) => ({ idleTimeout: v })),
    themeMenu(settings),
    presetMenu('Position', POSITIONS, settings.position, (a, b) => a === b, (v) => ({ position: v })),
    presetMenu('Eye Color', IRIS_PRESETS, settings.irisColor, (a, b) => a === b, (v) => ({ irisColor: v })),
    presetMenu('Background', BACKGROUND_PRESETS, settings.backgroundDim, near, (v) => ({ backgroundDim: v })),
    blinkMenu(settings),
    closingMenu(settings),
    cameraMenu(settings, cameras),
    screensMenu(settings, displays),
    separator,
    toggle('Show Text (Welcome / Bored)', settings.showCaptions, 'showCaptions'),
    toggle('Mirror Camera', settings.mirrorCamera, 'mirrorCamera'),
  ];
  if (platform === 'darwin') items.push(toggle("Don't Show During Video", settings.respectVideoPlayback, 'respectVideoPlayback'));
  items.push(
    toggle('Open at Login', settings.openAtLogin, 'openAtLogin'),
    toggle('Show Debug Info', settings.showDebugInfo, 'showDebugInfo'),
    separator,
    { label: 'Settings…', accelerator: 'CommandOrControl+,', action: command('settings') },
    toggle(settings.paused ? 'Paused' : 'Pause', settings.paused, 'paused'),
    separator,
    { label: 'Quit Big Eyes', accelerator: 'CommandOrControl+Q', action: command('quit') },
  );
  return items;
}
