import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  systemPreferences,
  Tray,
  type Display,
  type MenuItemConstructorOptions,
} from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IdleMonitor, pointInRects } from '../core/idle';
import { IPC, type CameraInfo, type DisplaySummary, type FacesMessage, type OverlayRole } from '../core/ipc';
import { selectDisplays, type GazeReference, type Settings } from '../core/settings';
import { buildMenuModel, type MenuAction, type MenuNode } from './menu-model';
import { SettingsStore } from './store';
import { displaySleepPrevented, setLinuxAutostart } from './system';

// ---- Startup --------------------------------------------------------------------------------------

const args = new Set(process.argv.slice(1));
const SHOW_AT_START = args.has('--show-eyes');
const FORCE_DEBUG = args.has('--debug-eyes');
/** Testing aid: ignore keyboard and mouse input, so the eyes stay until the app quits. */
const STAY = args.has('--stay-eyes');
/** Testing aids: show only on the built-in screen, and use the camera whose name contains this text. */
const INTERNAL_SCREEN_ONLY = args.has('--internal-screen-only');
const GUIDED_TEST = args.has('--guided-test');
const CAMERA_NAME = process.argv.find((a) => a.startsWith('--camera-name='))?.slice('--camera-name='.length);
const debugLog = (...items: unknown[]): void => {
  if (FORCE_DEBUG) console.log('[main]', ...items);
};
const snapshotIndex = process.argv.indexOf('--snapshot');
const SNAPSHOT_DIR = snapshotIndex > 0 ? process.argv[snapshotIndex + 1] : undefined;

/** Folder with the built renderer files (html, js, wasm, model). */
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
/** Large binary files (wasm, model) are unpacked from the asar archive in packaged builds. */
const UNPACKED_RENDERER_DIR = RENDERER_DIR.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');

// `app://` serves the renderer files. It behaves like a normal https origin, so fetch(), WebAssembly
// streaming and camera access work, which they do not for file:// URLs.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** Testing aid: keep settings in another folder, for example to try the defaults. */
const USER_DATA_DIR = process.argv.find((a) => a.startsWith('--settings-dir='))?.slice('--settings-dir='.length);
if (USER_DATA_DIR) app.setPath('userData', path.resolve(USER_DATA_DIR));
// Snapshots for the docs always use default settings, never the user's own file.
if (SNAPSHOT_DIR && !USER_DATA_DIR) {
  app.setPath('userData', path.join(os.tmpdir(), `big-eyes-snapshot-${process.pid}`));
}

if (!SNAPSHOT_DIR && !app.requestSingleInstanceLock()) {
  app.quit();
}

// Transparent windows on Linux need this on some drivers.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');

let store: SettingsStore;
let tray: Tray | null = null;
interface Overlay {
  window: BrowserWindow;
  role: OverlayRole;
  /** Eye box in screen coordinates, reported by the page. */
  eyeArea: { x: number; y: number; width: number; height: number } | null;
}
let overlays: Overlay[] = [];
/** Extra space around the eyes (pixels) that also counts as "inside". */
const EYE_AREA_MARGIN = 24;
let settingsWindow: BrowserWindow | null = null;
let cameras: CameraInfo[] = [];
let screenLocked = false;
let checking = false;
const idle = new IdleMonitor(60);
let lastCursor = { x: 0, y: 0 };

const nowSeconds = (): number => performance.now() / 1000;

/** Saved settings plus command-line overrides. Overrides are never saved. */
function effectiveSettings(): Settings {
  let s = store.get();
  if (FORCE_DEBUG) s = { ...s, showDebugInfo: true };
  if (CAMERA_NAME) s = { ...s, cameraId: null, cameraLabel: CAMERA_NAME };
  return s;
}

function chosenDisplays(): Display[] {
  const all = screen.getAllDisplays();
  const choice = INTERNAL_SCREEN_ONLY ? ({ mode: 'builtin' } as const) : store.get().screens;
  return selectDisplays(all, screen.getPrimaryDisplay().id, choice);
}

// ---- Protocol and permissions ---------------------------------------------------------------------

function registerAppProtocol(): void {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    // app://bundle/<path>. Resolve inside RENDERER_DIR only; reject path traversal.
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.normalize(path.join(RENDERER_DIR, relative));
    if (url.host !== 'bundle' || !target.startsWith(RENDERER_DIR + path.sep)) {
      return new Response('Not found', { status: 404 });
    }
    const unpacked = /^(wasm|models)\//.test(relative) ? path.join(UNPACKED_RENDERER_DIR, relative) : target;
    return net.fetch(pathToFileURL(unpacked).toString());
  });
}

function isOwnPage(url: string): boolean {
  return url.startsWith('app://bundle/');
}

function restrictPermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : [];
    const ok = isOwnPage(webContents.getURL()) && permission === 'media' && !mediaTypes.includes('audio');
    callback(ok);
  });
  ses.setPermissionCheckHandler((webContents, permission) => {
    return Boolean(webContents && isOwnPage(webContents.getURL()) && (permission === 'media' || permission === 'mediaKeySystem'));
  });
  // No navigation away from our pages, no new windows.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isOwnPage(url)) event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

async function ensureCameraAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true;
  const status = systemPreferences.getMediaAccessStatus('camera');
  if (status === 'granted') return true;
  if (status === 'not-determined') return systemPreferences.askForMediaAccess('camera');
  return false;
}

// ---- Overlay windows ------------------------------------------------------------------------------

function displaySummaries(): DisplaySummary[] {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label || `Screen ${i + 1}`,
    primary: d.id === primary,
    internal: Boolean(d.internal),
    width: d.size.width,
    height: d.size.height,
  }));
}

function webPreferences(role: OverlayRole | null): Electron.WebPreferences {
  return {
    preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    additionalArguments: role ? [`--big-eyes-role=${JSON.stringify(role)}`] : [],
  };
}

/** In --debug mode, prints messages from a page's console in the terminal. */
function forwardConsole(window: BrowserWindow, name: string): void {
  window.webContents.on('console-message', (details) => {
    console.log(`[${name}] ${details.level}: ${details.message}`);
  });
  window.webContents.on('render-process-gone', (_e, details) => console.error(`[${name}] renderer gone: ${details.reason}`));
}

function createOverlay(display: Display, isTracker: boolean): Overlay {
  const role: OverlayRole = { displayId: display.id, isTracker, ...(GUIDED_TEST && { guidedTest: true }) };
  const { x, y, width, height } = display.bounds;
  const window = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: webPreferences(role),
  });
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  // Clicks go through to the apps below. Any click or key press resets the idle time, which hides the eyes.
  window.setIgnoreMouseEvents(true);
  window.setBounds(display.bounds);
  if (FORCE_DEBUG) forwardConsole(window, `overlay ${display.id}`);
  void window.loadURL('app://bundle/overlay.html');
  window.webContents.on('did-finish-load', () => {
    window.webContents.send(IPC.settings, effectiveSettings());
    if (idle.isShowing) window.webContents.send(IPC.visibility, true);
  });
  return { window, role, eyeArea: null };
}

/** Creates one overlay window per selected display. Keeps them hidden until needed. */
function rebuildOverlays(): void {
  for (const o of overlays) if (!o.window.isDestroyed()) o.window.destroy();
  const chosen = chosenDisplays();
  debugLog('overlay screens:', chosen.map((d) => `${d.id} ${d.label} ${d.bounds.width}x${d.bounds.height}${d.internal ? ' (built-in)' : ''}`).join(', '));
  // The camera runs in one window only: the one on the main screen if it is chosen.
  const primaryId = screen.getPrimaryDisplay().id;
  const trackerId = (chosen.find((d) => d.id === primaryId) ?? chosen[0])?.id;
  overlays = chosen.map((d) => createOverlay(d, d.id === trackerId));
  if (idle.isShowing) showOverlays();
}

let hideTimer: NodeJS.Timeout | null = null;

function showOverlays(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  lastCursor = screen.getCursorScreenPoint();
  void ensureCameraAccess().then((granted) => {
    debugLog('camera access:', process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('camera') : 'n/a', granted);
    if (!granted) setStatus('Camera access is off. Allow it in System Settings > Privacy & Security > Camera.');
  });
  for (const { window } of overlays) {
    if (window.isDestroyed()) continue;
    window.showInactive(); // never take focus from the app you work in
    window.setAlwaysOnTop(true, 'screen-saver');
    window.webContents.send(IPC.visibility, true);
  }
  updateTray();
}

function hideOverlays(): void {
  for (const o of overlays) o.eyeArea = null;
  for (const { window } of overlays) if (!window.isDestroyed()) window.webContents.send(IPC.visibility, false);
  // Let the fade-out animation finish, then hide the windows.
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (idle.isShowing) return;
    for (const { window } of overlays) if (!window.isDestroyed()) window.hide();
  }, 450);
  updateTray();
}

function show(): void {
  if (idle.forceShow(nowSeconds(), powerMonitor.getSystemIdleTime())) showOverlays();
}

function hide(): void {
  if (idle.forceHide()) hideOverlays();
}

// ---- Idle loop ------------------------------------------------------------------------------------

async function checkIdle(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const s = store.get();
    idle.timeout = s.idleTimeout;
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const now = nowSeconds();
    let pointerMoved = false;
    let pointerInEyes = false;
    if (idle.isShowing) {
      const cursor = screen.getCursorScreenPoint();
      pointerMoved = Math.abs(cursor.x - lastCursor.x) + Math.abs(cursor.y - lastCursor.y) > 2;
      lastCursor = cursor;
      const areas = overlays.flatMap((o) => (o.eyeArea ? [o.eyeArea] : []));
      pointerInEyes = pointInRects(cursor, areas, EYE_AREA_MARGIN);
    }
    let blocked = s.paused || screenLocked || overlays.length === 0;
    // Asking for video playback is slower, so do it only right before showing.
    if (!blocked && !idle.isShowing && idleSeconds >= idle.timeout && s.respectVideoPlayback) {
      blocked = await displaySleepPrevented();
    }
    if (STAY && idle.isShowing) return;
    const event = idle.update({ idleSeconds, now, blocked, pointerMoved, pointerInEyes, mouseRule: s.mouseRule });
    if (event) debugLog(`idle event: ${event}${event === 'hide' ? ` (${idle.lastHideReason})` : ''} idle=${idleSeconds}s`);
    if (event === 'show') showOverlays();
    if (event === 'hide') hideOverlays();
  } finally {
    checking = false;
  }
}

// ---- Tray menu ------------------------------------------------------------------------------------

function trayIcon(): Electron.NativeImage {
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(path.join(ASSETS_DIR, 'icons', file));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  return image;
}

function toElectronMenu(nodes: MenuNode[]): MenuItemConstructorOptions[] {
  return nodes.map((node) => {
    const item: MenuItemConstructorOptions = {
      type: node.type ?? 'normal',
      ...(node.label !== undefined && { label: node.label }),
      ...(node.checked !== undefined && { checked: node.checked }),
      ...(node.enabled !== undefined && { enabled: node.enabled }),
      ...(node.accelerator && { accelerator: node.accelerator, registerAccelerator: false }),
    };
    if (node.submenu) item.submenu = toElectronMenu(node.submenu);
    const action = node.action;
    if (action) item.click = () => runAction(action);
    return item;
  });
}

function runAction(action: MenuAction): void {
  if (action.kind === 'patch') {
    store.update(action.patch);
    return;
  }
  switch (action.command) {
    case 'show':
      // Wait a moment, so the click that closes the menu does not hide the eyes again.
      setTimeout(show, 400);
      break;
    case 'calibrate':
      setTimeout(calibrate, 400);
      break;
    case 'settings':
      openSettingsWindow();
      break;
    case 'refreshCameras':
      // Camera names are read by a page. The settings window asks for camera access and refreshes the list.
      openSettingsWindow();
      break;
    case 'quit':
      app.quit();
      break;
  }
}

function updateTray(): void {
  if (!tray) return;
  const menu = Menu.buildFromTemplate(toElectronMenu(buildMenuModel(store.get(), cameras, displaySummaries())));
  tray.setContextMenu(menu);
  const s = store.get();
  tray.setToolTip(s.paused ? 'Big Eyes (paused)' : 'Big Eyes');
}

function calibrate(): void {
  show();
  for (const { window } of overlays) window.webContents.send(IPC.calibrate);
}

// ---- Settings window ------------------------------------------------------------------------------

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 760,
    minWidth: 480,
    minHeight: 520,
    title: 'Big Eyes Settings',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#15121c',
    webPreferences: webPreferences(null),
  });
  void settingsWindow.loadURL('app://bundle/settings.html');
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
    if (process.platform === 'darwin') app.dock?.hide();
  });
  if (process.platform === 'darwin') void app.dock?.show();
}

function setStatus(message: string): void {
  console.warn('[big-eyes]', message);
  tray?.setToolTip(`Big Eyes — ${message}`);
  settingsWindow?.webContents.send(IPC.status, message);
}

// ---- Settings changes -----------------------------------------------------------------------------

async function applyLoginItem(enabled: boolean): Promise<void> {
  try {
    if (process.platform === 'linux') await setLinuxAutostart(enabled, process.execPath);
    else app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    setStatus(`Could not change "Open at Login": ${String(error)}`);
  }
}

function onSettingsChanged(previous: Settings, next: Settings): void {
  const displaysChanged = JSON.stringify(previous.screens) !== JSON.stringify(next.screens);
  if (displaysChanged) rebuildOverlays();
  const s = effectiveSettings();
  for (const { window } of overlays) if (!window.isDestroyed()) window.webContents.send(IPC.settings, s);
  settingsWindow?.webContents.send(IPC.settings, next);
  if (previous.openAtLogin !== next.openAtLogin) void applyLoginItem(next.openAtLogin);
  if (next.paused && !previous.paused) hide();
  updateTray();
}

// ---- IPC ------------------------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => store.get());
  ipcMain.handle(IPC.updateSettings, (_e, patch: unknown) => store.update(patch));
  ipcMain.handle(IPC.resetSettings, () => store.reset());
  ipcMain.handle(IPC.getDisplays, () => displaySummaries());

  ipcMain.on(IPC.faces, (event, message: FacesMessage) => {
    // Only the tracker window may send faces. Forward them to the other overlays.
    const sender = overlays.find((o) => o.window.webContents === event.sender);
    if (!sender?.role.isTracker) return;
    for (const o of overlays) if (o !== sender && !o.window.isDestroyed()) o.window.webContents.send(IPC.facesBroadcast, message);
  });
  ipcMain.on(IPC.eyeArea, (event, rect: unknown) => {
    const overlay = overlays.find((o) => o.window.webContents === event.sender);
    if (!overlay || overlay.window.isDestroyed() || typeof rect !== 'object' || rect === null) return;
    const r = rect as Record<string, unknown>;
    const values = [r.x, r.y, r.width, r.height];
    if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return;
    // Window coordinates (CSS pixels) to screen coordinates.
    const bounds = overlay.window.getBounds();
    overlay.eyeArea = { x: bounds.x + (r.x as number), y: bounds.y + (r.y as number), width: r.width as number, height: r.height as number };
  });
  ipcMain.on(IPC.requestClose, (event) => {
    if (!overlays.some((o) => o.window.webContents === event.sender)) return;
    debugLog('look-to-close: hiding the eyes');
    hide();
  });
  ipcMain.on(IPC.cameras, (_e, list: unknown) => {
    if (!Array.isArray(list)) return;
    cameras = list
      .filter((c): c is CameraInfo => typeof c?.deviceId === 'string' && typeof c?.label === 'string')
      .slice(0, 32);
    updateTray();
  });
  ipcMain.on(IPC.calibrated, (event, reference: GazeReference) => {
    const sender = overlays.find((o) => o.window.webContents === event.sender);
    if (!sender?.role.isTracker) return;
    store.update({ attention: { reference } });
  });
  ipcMain.on(IPC.status, (_e, message: unknown) => {
    if (typeof message === 'string') setStatus(message.slice(0, 300));
  });
  ipcMain.on(IPC.preview, () => setTimeout(show, 300));
  ipcMain.on(IPC.requestCalibrate, () => setTimeout(calibrate, 300));
}

// ---- Snapshot mode (for docs and visual checks) ---------------------------------------------------

async function runSnapshot(dir: string): Promise<void> {
  const { promises: fs } = await import('node:fs');
  await fs.mkdir(dir, { recursive: true });
  const window = new BrowserWindow({
    width: 1200,
    height: 700,
    show: false,
    webPreferences: { ...webPreferences(null), offscreen: true },
  });
  await window.loadURL('app://bundle/snapshot.html');
  const moods = (await window.webContents.executeJavaScript('window.snapshotMoods')) as string[];
  for (const mood of moods) {
    await window.webContents.executeJavaScript(`window.renderMood(${JSON.stringify(mood)})`);
    await new Promise((r) => setTimeout(r, 120));
    const image = await window.webContents.capturePage();
    await fs.writeFile(path.join(dir, `${mood}.png`), image.toPNG());
    console.log(`wrote ${path.join(dir, `${mood}.png`)}`);
  }
  window.destroy();
  // A strip with every theme, for the README.
  const strip = new BrowserWindow({ width: 1500, height: 300, show: false, webPreferences: { ...webPreferences(null), offscreen: true } });
  await strip.loadURL('app://bundle/snapshot.html?strip=1');
  await strip.webContents.executeJavaScript('window.renderStrip()');
  await new Promise((r) => setTimeout(r, 150));
  await fs.writeFile(path.join(dir, 'themes.png'), (await strip.webContents.capturePage()).toPNG());
  console.log(`wrote ${path.join(dir, 'themes.png')}`);
  strip.destroy();
  // The settings window, rendered offscreen, for the docs.
  const settings = new BrowserWindow({ width: 560, height: 900, show: false, webPreferences: { ...webPreferences(null), offscreen: true } });
  forwardConsole(settings, 'settings');
  await settings.loadURL('app://bundle/settings.html');
  await new Promise((r) => setTimeout(r, 1500));
  await fs.writeFile(path.join(dir, 'settings.png'), (await settings.webContents.capturePage()).toPNG());
  console.log(`wrote ${path.join(dir, 'settings.png')}`);
  app.quit();
}

// ---- App lifecycle --------------------------------------------------------------------------------

app.on('second-instance', () => openSettingsWindow());
app.on('window-all-closed', () => {
  // Stay in the tray.
});

void app.whenReady().then(async () => {
  registerAppProtocol();
  restrictPermissions();
  store = new SettingsStore(app.getPath('userData'));
  registerIpc();

  if (SNAPSHOT_DIR) {
    await runSnapshot(path.resolve(SNAPSHOT_DIR));
    return;
  }

  if (process.platform === 'darwin') app.dock?.hide();
  let previous = store.get();
  store.onChange((next) => {
    const before = previous;
    previous = next;
    onSettingsChanged(before, next);
  });

  tray = new Tray(trayIcon());
  tray.on('click', () => {
    if (process.platform !== 'darwin') tray?.popUpContextMenu();
  });
  rebuildOverlays();
  updateTray();

  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);
  powerMonitor.on('lock-screen', () => {
    screenLocked = true;
    hide();
  });
  powerMonitor.on('unlock-screen', () => {
    screenLocked = false;
  });
  powerMonitor.on('suspend', hide);

  setInterval(() => void checkIdle(), 100);
  if (SHOW_AT_START) setTimeout(show, 1200);
});

app.on('before-quit', () => {
  void store?.flush();
});
