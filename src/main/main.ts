import {
  app,
  BrowserWindow,
  powerSaveBlocker,
  ipcMain,
  Menu,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
  type Display,
  type MenuItemConstructorOptions,
} from 'electron';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { IdleMonitor, pointInRects } from '../core/idle';
import { PresenceCheck } from '../core/presence';
import { ActivityClock } from '../core/activity';
import type { FaceObservation } from '../core/face';
import { IPC, type CameraInfo, type DisplaySummary, type FacesMessage, type OverlayRole } from '../core/ipc';
import { blurActive, screenSaverSeconds, selectDisplays, type GazeReference, type Settings } from '../core/settings';
import { buildMenuModel, type MenuAction, type MenuNode } from './menu-model';
import { SettingsStore } from './store';
import { displaySleepPrevented, screenSaverRunning, setLinuxAutostart, systemScreenSaverSeconds } from './system';
import { Updater, updateMenuLabel, type UpdateState } from './updater';
import { log as writeLog, logFile } from './logger';
import { ISSUES_URL, RELEASES_URL, REPO_URL } from '../core/update';
import type { AboutInfo } from '../core/ipc';

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
  if (FORCE_DEBUG) console.log(`[main ${(performance.now() / 1000).toFixed(1)}s]`, ...items);
};
/** Important events: always written to the log file, and to the terminal in debug mode. */
const eventLog = (...items: unknown[]): void => {
  writeLog(...items);
  debugLog(...items);
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
let aboutWindow: BrowserWindow | null = null;
let updater: Updater | null = null;
let cameras: CameraInfo[] = [];
let screenLocked = false;
let checking = false;
const idle = new IdleMonitor(60);
const presence = new PresenceCheck();
/** Idle clock that ignores tiny mouse jitter (see src/core/activity.ts). */
const activity = new ActivityClock(performance.now() / 1000);
/** Id of the power save blocker that keeps the screen saver away ("replace" mode), or null. */
let screenSaverBlocker: number | null = null;
let screenSaverActive = false;
let lastScreenSaverCheck = 0;
let lastActivityLog = 0;
let lastBlockLog = 0;
/** Whether the overlays are blurred right now. */
let blurOn = false;
/** The system's screen saver (or display sleep) time in seconds, read at start and every 10 minutes. */
let systemSaverSeconds: number | null = null;
let presenceStartedAt = 0;
let presenceFrames = 0;
let lastCursor = { x: 0, y: 0 };

const nowSeconds = (): number => performance.now() / 1000;

/** Saved settings plus command-line overrides. Overrides are never saved. */
function effectiveSettings(): Settings {
  let s = store.get();
  if (FORCE_DEBUG) s = { ...s, showDebugInfo: true };
  if (CAMERA_NAME) {
    // --camera-name=A,B uses the cameras whose names contain A and B (A is the main camera).
    const cameras = CAMERA_NAME.split(',').map((label) => ({ id: '', label: label.trim() }));
    s = { ...s, cameras: { mode: 'selected', cameras } };
  }
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

/**
 * Hosts the app must never contact. MediaPipe has a built-in usage logger that posts to Google; Big Eyes
 * promises no tracking, so these requests are cancelled for every window (the page security policy also
 * blocks them). The only network use of the app is the update check to github.com.
 */
const BLOCKED_HOSTS = ['odml.pa.googleapis.com', 'play.googleapis.com', 'firebaselogging-pa.googleapis.com'];

function restrictPermissions(): void {
  const ses = session.defaultSession;
  ses.webRequest.onBeforeRequest({ urls: BLOCKED_HOSTS.map((h) => `*://${h}/*`) }, (details, callback) => {
    debugLog('blocked a request to', new URL(details.url).host);
    callback({ cancel: true });
  });
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

/**
 * Turns the system blur behind an overlay window on or off.
 * macOS: the "fullscreen UI" material (the strong blur behind full-screen system panels).
 * Windows 11: acrylic. Linux: no system blur; the page draws a strong tint instead.
 */
function applyBlur(window: BrowserWindow, on: boolean): void {
  try {
    if (process.platform === 'darwin') window.setVibrancy(on ? 'fullscreen-ui' : null);
    else if (process.platform === 'win32') window.setBackgroundMaterial(on ? 'acrylic' : 'none');
  } catch (error) {
    writeLog('blur not available:', String(error));
  }
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
    // The system blur stays on even though the overlay never has focus.
    ...(process.platform === 'darwin' && { visualEffectState: 'active' as const }),
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
  applyBlur(window, blurOn);
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
  // Remove the blur after the fade-out, so the screen does not jump.
  setTimeout(() => {
    if (!idle.isShowing) updateBlur(0);
  }, 500);
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
  presence.reset();
  const now = nowSeconds();
  if (idle.forceShow(now, activity.sample(now, powerMonitor.getSystemIdleTime(), screen.getCursorScreenPoint()))) showOverlays();
}

function hide(): void {
  if (idle.forceHide()) hideOverlays();
}

// ---- Idle loop ------------------------------------------------------------------------------------

/** Our own process ids (main, GPU, renderers), so pmset does not count our own screen saver blocker. */
function ownPids(): number[] {
  return app.getAppMetrics().map((m) => m.pid);
}

/** "Replace the screen saver" mode: hold a display-sleep blocker, which also keeps the screen saver away. */
function applyScreenSaverMode(s: Settings): void {
  const want = s.screenSaver === 'replace' && !s.paused;
  if (want && screenSaverBlocker === null) {
    screenSaverBlocker = powerSaveBlocker.start('prevent-display-sleep');
    eventLog('screen saver: blocked (eyes replace it)');
  } else if (!want && screenSaverBlocker !== null) {
    powerSaveBlocker.stop(screenSaverBlocker);
    screenSaverBlocker = null;
    eventLog('screen saver: allowed');
  }
}

let lastIdleSeconds = 0;

/** Turns the blur behind the eyes on or off, from the settings and how long the computer has been idle. */
function updateBlur(idleSeconds: number): void {
  const want = idle.isShowing && blurActive(store.get(), idleSeconds, systemSaverSeconds);
  if (want === blurOn) return;
  blurOn = want;
  if (want) {
    const at = screenSaverSeconds(store.get(), systemSaverSeconds);
    eventLog(`blur on (idle ${Math.round(idleSeconds)}s, screen saver time ${Math.round(at)}s)`);
  }
  for (const o of overlays) {
    if (o.window.isDestroyed()) continue;
    applyBlur(o.window, want);
    o.window.webContents.send(IPC.blur, want);
  }
}

function setPresenceCamera(active: boolean): void {
  for (const o of overlays) if (o.role.isTracker && !o.window.isDestroyed()) o.window.webContents.send(IPC.presenceCheck, active);
}

async function checkIdle(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const s = store.get();
    idle.timeout = s.idleTimeout;
    const now = nowSeconds();
    const cursor = screen.getCursorScreenPoint();
    const systemIdle = powerMonitor.getSystemIdleTime();
    // Filtered idle time: tiny mouse jitter does not count as input.
    const idleSeconds = activity.sample(now, systemIdle, cursor);
    if (FORCE_DEBUG && now - lastActivityLog >= 10) {
      lastActivityLog = now;
      debugLog(`activity: idle=${idleSeconds.toFixed(1)}s system=${systemIdle}s`);
    }
    let pointerMoved = false;
    let pointerInEyes = false;
    if (idle.isShowing) {
      // Only real mouse movement (more than the jitter threshold) counts.
      pointerMoved = activity.pointerActive() && Math.abs(cursor.x - lastCursor.x) + Math.abs(cursor.y - lastCursor.y) > 0;
      lastCursor = cursor;
      const areas = overlays.flatMap((o) => (o.eyeArea ? [o.eyeArea] : []));
      pointerInEyes = pointInRects(cursor, areas, EYE_AREA_MARGIN);
    }
    // Screen saver ("pause" mode): check about once a second while idle; it never runs while you type.
    if (s.screenSaver === 'pause' && idleSeconds >= Math.min(idle.timeout, 5) && now - lastScreenSaverCheck >= 1) {
      lastScreenSaverCheck = now;
      const running = await screenSaverRunning();
      if (running !== screenSaverActive) eventLog(`screen saver ${running ? 'started' : 'stopped'}`);
      screenSaverActive = running;
    } else if (s.screenSaver !== 'pause' || idleSeconds < 1) {
      screenSaverActive = false;
    }
    let blocked = s.paused || screenLocked || overlays.length === 0 || screenSaverActive;
    const reasons: string[] = [];
    if (s.paused) reasons.push('paused');
    if (screenLocked) reasons.push('screen locked');
    if (overlays.length === 0) reasons.push('no screen selected');
    if (screenSaverActive) reasons.push('screen saver running');
    // `canShow` is false after the eyes were dismissed (key, mouse onto the eyes, or look-to-close) until new
    // input, so no camera check runs in that time.
    const due = !blocked && idle.canShow(idleSeconds);
    // Asking for video playback is slower, so do it only right before showing.
    if (due && s.respectVideoPlayback && (await displaySleepPrevented(ownPids()))) {
      blocked = true;
      reasons.push('an app keeps the display awake (video)');
    }
    if (idleSeconds >= idle.timeout && !idle.isShowing && reasons.length && now - lastBlockLog >= 60) {
      lastBlockLog = now;
      eventLog(`eyes held back: ${reasons.join(', ')} (idle=${Math.round(idleSeconds)}s)`);
    }
    if (idleSeconds >= idle.timeout && !idle.isShowing && !reasons.length && !idle.canShow(idleSeconds) && now - lastBlockLog >= 300) {
      lastBlockLog = now;
      eventLog(`eyes held back: dismissed earlier, waiting for keyboard or mouse (idle=${Math.round(idleSeconds)}s)`);
    }

    // "Wait while someone looks at the screen": before showing, take a short look with the camera.
    if (!due && presence.phase === 'checking' && !idle.isShowing) {
      eventLog('presence: check stopped (the eyes cannot show now)');
      presence.reset();
      setPresenceCamera(false);
    }
    if (idleSeconds < idle.timeout && presence.phase !== 'idle') {
      debugLog(`presence: reset by input (idle=${idleSeconds.toFixed(1)}s, system=${systemIdle}s, phase=${presence.phase})`);
      presence.reset();
      setPresenceCamera(false);
    }
    if (due && !blocked && s.waitWhileWatched) {
      if (presence.phase === 'checking') {
        const result = presence.result(now);
        if (result === null) return;
        if (result === 'watched') {
          // Close the camera only when the eyes wait. When they show, the overlay keeps using it.
          setPresenceCamera(false);
          eventLog(`presence: someone is looking at the screen, the eyes wait (${presenceFrames} frames, ${(now - presenceStartedAt).toFixed(1)}s)`);
          return;
        }
        eventLog(`presence: nobody looking, showing the eyes (${presenceFrames} frames, ${(now - presenceStartedAt).toFixed(1)}s${presenceFrames === 0 ? ', the camera sent no frames' : ''})`);
      } else if (presence.due(now)) {
        eventLog('presence: checking with the camera');
        presence.start(now, s.attention, s.mirrorCamera);
        presenceStartedAt = now;
        presenceFrames = 0;
        setPresenceCamera(true);
        return;
      } else {
        return; // someone was there; wait for the next check
      }
    }

    lastIdleSeconds = idleSeconds;
    updateBlur(idleSeconds);
    if (STAY && idle.isShowing) return;
    const event = idle.update({ idleSeconds, now, blocked, pointerMoved, pointerInEyes, mouseRule: s.mouseRule });
    if (event) eventLog(`idle event: ${event}${event === 'hide' ? ` (${idle.lastHideReason})` : ''} idle=${idleSeconds.toFixed(1)}s system=${systemIdle}s`);
    if (event === 'show') showOverlays();
    if (event === 'hide') {
      presence.reset();
      hideOverlays();
    }
    updateBlur(idleSeconds);
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
    case 'about':
      openAboutWindow();
      break;
    case 'checkUpdates':
      void updater?.check(true);
      break;
    case 'update':
      updater?.act();
      break;
    case 'quit':
      app.quit();
      break;
  }
}

function updateTray(): void {
  if (!tray) return;
  const label = updater ? updateMenuLabel(updater.state) : null;
  const model = buildMenuModel(store.get(), cameras, displaySummaries(), process.platform, label);
  const menu = Menu.buildFromTemplate(toElectronMenu(model));
  tray.setContextMenu(menu);
  const s = store.get();
  tray.setToolTip(s.paused ? 'Big Eyes (paused)' : 'Big Eyes');
}

function calibrate(): void {
  show();
  for (const { window } of overlays) window.webContents.send(IPC.calibrate);
}

// ---- About window ---------------------------------------------------------------------------------

const PLATFORM_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

function updateStatusText(state: UpdateState): string {
  switch (state.kind) {
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return "You're up to date.";
    case 'available':
      return `Version ${state.version} is available.`;
    case 'downloading':
      return `Downloading version ${state.version}… ${state.percent}%`;
    case 'ready':
      return `Version ${state.version} is ready. Restart to update.`;
    case 'error':
      return 'Could not check for updates.';
    default:
      return '';
  }
}

function aboutInfo(): AboutInfo {
  const channel = updater?.channel ?? 'none';
  const updateMode =
    channel === 'auto'
      ? 'Updates install automatically'
      : channel === 'none'
        ? 'Development build'
        : 'You are told about new versions';
  return {
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    platform: PLATFORM_NAMES[process.platform] ?? process.platform,
    arch: process.arch,
    updateMode,
    updateStatus: updater ? updateStatusText(updater.state) : '',
    repoUrl: REPO_URL,
    license: 'Apache-2.0',
    author: 'Eran Raichstein',
  };
}

function openAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show();
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 380,
    height: 440,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'About Big Eyes',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#15121c',
    webPreferences: webPreferences(null),
  });
  void aboutWindow.loadURL('app://bundle/about.html');
  aboutWindow.once('ready-to-show', () => aboutWindow?.show());
  aboutWindow.on('closed', () => {
    aboutWindow = null;
    if (process.platform === 'darwin' && !settingsWindow) app.dock?.hide();
  });
  if (process.platform === 'darwin') void app.dock?.show();
}

/** Only our own GitHub pages may be opened from the app. */
function openLink(url: unknown): void {
  if (typeof url !== 'string') return;
  if (url === REPO_URL || url.startsWith(`${REPO_URL}/`) || url === RELEASES_URL || url === ISSUES_URL) void shell.openExternal(url);
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
    if (process.platform === 'darwin' && !aboutWindow) app.dock?.hide();
  });
  if (process.platform === 'darwin') void app.dock?.show();
}

function setStatus(message: string): void {
  console.warn('[big-eyes]', message);
  writeLog('status:', message);
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
  applyScreenSaverMode(next);
  if (idle.isShowing) updateBlur(lastIdleSeconds);
  if (!next.waitWhileWatched && presence.phase !== 'idle') {
    presence.reset();
    setPresenceCamera(false);
  }
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
  ipcMain.handle(IPC.getAbout, () => aboutInfo());
  ipcMain.on(IPC.checkUpdates, () => void updater?.check(true));
  ipcMain.on(IPC.openLink, (_e, url: unknown) => openLink(url));
  ipcMain.on(IPC.presenceFaces, (event, message: { faces?: unknown; error?: unknown }) => {
    const sender = overlays.find((o) => o.window.webContents === event.sender);
    if (!sender?.role.isTracker || presence.phase !== 'checking') return;
    if (typeof message?.error === 'string') {
      // A camera problem must never keep the eyes away.
      eventLog('presence: camera error, ignoring the check:', message.error);
      presence.fail();
      setPresenceCamera(false);
      return;
    }
    if (Array.isArray(message?.faces)) {
      presenceFrames++;
      presence.report(message.faces as FaceObservation[], nowSeconds());
    }
  });
  ipcMain.on(IPC.requestClose, (event) => {
    if (!overlays.some((o) => o.window.webContents === event.sender)) return;
    eventLog('look-to-close: hiding the eyes');
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
  ipcMain.on(IPC.log, (_e, message: unknown) => {
    if (typeof message === 'string') eventLog(message.slice(0, 300));
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
  // The About window, rendered offscreen, for checking.
  const about = new BrowserWindow({ width: 380, height: 440, show: false, webPreferences: { ...webPreferences(null), offscreen: true } });
  await about.loadURL('app://bundle/about.html');
  await new Promise((r) => setTimeout(r, 1200));
  await fs.writeFile(path.join(dir, 'about.png'), (await about.webContents.capturePage()).toPNG());
  console.log(`wrote ${path.join(dir, 'about.png')}`);
  about.destroy();
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
  eventLog(`Big Eyes ${app.getVersion()} started (${process.platform} ${process.arch}); log: ${logFile()}`);
  updater = new Updater({
    autoCheckEnabled: () => store.get().checkForUpdates,
    lastAnnounced: () => store.get().lastAnnouncedVersion,
    setLastAnnounced: (version) => store.update({ lastAnnouncedVersion: version }),
    onState: () => {
      updateTray();
      if (aboutWindow && !aboutWindow.isDestroyed()) aboutWindow.webContents.send(IPC.aboutUpdate, aboutInfo());
    },
    log: (...items) => debugLog(...items),
  });
  updater.start();
  app.setAboutPanelOptions({
    applicationName: 'Big Eyes',
    applicationVersion: app.getVersion(),
    copyright: '© 2026 Eran Raichstein and contributors. Apache-2.0 License.',
    website: REPO_URL,
  });
  const readSaverTime = async (): Promise<void> => {
    const seconds = await systemScreenSaverSeconds();
    if (seconds !== systemSaverSeconds) eventLog(`system screen saver / display sleep time: ${seconds ? `${Math.round(seconds / 60)} min` : 'none'}`);
    systemSaverSeconds = seconds;
  };
  void readSaverTime();
  setInterval(() => void readSaverTime(), 10 * 60 * 1000);
  rebuildOverlays();
  updateTray();
  applyScreenSaverMode(store.get());

  screen.on('display-added', rebuildOverlays);
  screen.on('display-removed', rebuildOverlays);
  screen.on('display-metrics-changed', rebuildOverlays);
  powerMonitor.on('lock-screen', () => {
    eventLog('screen locked');
    screenLocked = true;
    hide();
  });
  powerMonitor.on('unlock-screen', () => {
    eventLog('screen unlocked');
    screenLocked = false;
  });
  powerMonitor.on('suspend', () => {
    eventLog('system sleep');
    hide();
  });
  powerMonitor.on('resume', () => eventLog('system wake'));

  setInterval(() => void checkIdle(), 100);
  if (SHOW_AT_START) setTimeout(show, 1200);
});

app.on('before-quit', () => {
  void store?.flush();
});
