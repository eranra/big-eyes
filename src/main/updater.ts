import { app, clipboard, dialog, net, Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import {
  FIRST_CHECK_DELAY_SECONDS,
  INSTALL_COMMAND,
  isNewer,
  latestMetadataUrl,
  releaseUrl,
  RELEASES_URL,
  shouldAnnounce,
  UPDATE_CHECK_HOURS,
  updateChannel,
  versionFromMetadata,
  type UpdateChannel,
} from '../core/update';

/** Current update state, shown in the tray menu and the About window. */
export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'ready'; version: string }
  | { kind: 'error'; message: string };

export interface UpdaterHooks {
  /** Returns whether automatic checks are on. */
  autoCheckEnabled(): boolean;
  lastAnnounced(): string | null;
  setLastAnnounced(version: string): void;
  /** Called on every state change (to refresh the tray menu and the About window). */
  onState(state: UpdateState): void;
  log(...items: unknown[]): void;
}

/**
 * Checks GitHub Releases for new versions and installs them where the system allows.
 * See `src/core/update.ts` for which systems install automatically.
 */
export class Updater {
  readonly channel: UpdateChannel;
  state: UpdateState = { kind: 'idle' };
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(private readonly hooks: UpdaterHooks) {
    this.channel = updateChannel({ platform: process.platform, packaged: app.isPackaged, appImage: process.env.APPIMAGE });
    autoUpdater.logger = { info: (m: unknown) => hooks.log('updater:', m), warn: (m: unknown) => hooks.log('updater:', m), error: (m: unknown) => hooks.log('updater error:', m) } as never;
    // We decide when to download: only on systems that can install, after telling the user.
    autoUpdater.autoDownload = this.channel === 'auto';
    autoUpdater.autoInstallOnAppQuit = this.channel === 'auto';
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('download-progress', (p) => {
      if (this.state.kind === 'downloading' || this.state.kind === 'available') {
        this.set({ kind: 'downloading', version: this.state.version, percent: Math.round(p.percent) });
      }
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ kind: 'ready', version: info.version });
      void this.offerRestart(info.version);
    });
  }

  get currentVersion(): string {
    return app.getVersion();
  }

  /** Starts automatic checks: shortly after start, then every few hours. */
  start(): void {
    if (this.channel === 'none') return;
    const tick = (): void => {
      if (this.hooks.autoCheckEnabled()) void this.check(false);
    };
    setTimeout(tick, FIRST_CHECK_DELAY_SECONDS * 1000);
    this.timer = setInterval(tick, UPDATE_CHECK_HOURS * 3600 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Checks now. `manual` = the user asked ("Check for Updates…"): always show the result. */
  async check(manual: boolean): Promise<void> {
    if (this.channel === 'none') {
      if (manual) {
        await dialog.showMessageBox({
          type: 'info',
          message: 'Updates are off in development builds',
          detail: `This copy runs from source (version ${this.currentVersion}). Use git pull to update.`,
        });
      }
      return;
    }
    if (this.busy) return;
    if (this.state.kind === 'ready') {
      if (manual) void this.offerRestart(this.state.version);
      return;
    }
    this.busy = true;
    this.set({ kind: 'checking' });
    try {
      // Windows and AppImage use electron-updater (it downloads and installs). macOS and .deb only need the
      // newest version number, so read the release metadata directly; nothing is downloaded.
      const latest =
        this.channel === 'auto' ? (await autoUpdater.checkForUpdates())?.updateInfo.version : await this.fetchLatestVersion();
      if (!latest || !isNewer(latest, this.currentVersion)) {
        this.set({ kind: 'up-to-date', checkedAt: Date.now() });
        if (manual) {
          await dialog.showMessageBox({
            type: 'info',
            message: "You're up to date",
            detail: `Big Eyes ${this.currentVersion} is the newest version.`,
          });
        }
        return;
      }
      if (this.channel === 'auto') {
        // The download already started (autoDownload). Tell the user once; "Restart now" comes when it is ready.
        this.set({ kind: 'downloading', version: latest, percent: 0 });
        if (shouldAnnounce(latest, this.currentVersion, this.hooks.lastAnnounced(), manual)) {
          this.hooks.setLastAnnounced(latest);
          this.notify(`Big Eyes ${latest} is available`, 'Downloading in the background. You can restart when it is ready.');
        }
        return;
      }
      this.set({ kind: 'available', version: latest });
      if (shouldAnnounce(latest, this.currentVersion, this.hooks.lastAnnounced(), manual)) {
        this.hooks.setLastAnnounced(latest);
        await this.offerManualUpdate(latest);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      this.hooks.log('update check failed:', message);
      this.set({ kind: 'error', message });
      if (manual) {
        const { response } = await dialog.showMessageBox({
          type: 'warning',
          message: 'Could not check for updates',
          detail: `${message}\n\nYou can check the releases page yourself.`,
          buttons: ['Open Releases Page', 'OK'],
          defaultId: 1,
          cancelId: 1,
        });
        if (response === 0) void shell.openExternal(RELEASES_URL);
      }
    } finally {
      this.busy = false;
    }
  }

  /** Reads the newest published version from GitHub. Only github.com and its download host are contacted. */
  private async fetchLatestVersion(): Promise<string | undefined> {
    const response = await net.fetch(latestMetadataUrl(process.platform), {
      headers: { 'User-Agent': `Big-Eyes/${this.currentVersion}`, 'Cache-Control': 'no-cache' },
    });
    if (response.status === 404) return undefined; // no release yet
    if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
    const version = versionFromMetadata(await response.text());
    if (!version) throw new Error('The release information could not be read');
    this.hooks.log('updater: newest release is', version);
    return version;
  }

  /** macOS and .deb: show what is new and how to update. */
  async offerManualUpdate(version: string): Promise<void> {
    const mac = this.channel === 'notify-mac';
    const buttons = mac ? ['Open Release Page', 'Copy Update Command', 'Later'] : ['Open Release Page', 'Later'];
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `Big Eyes ${version} is available`,
      detail: mac
        ? `You have version ${this.currentVersion}.\n\nTo update, download the new version from the release page, ` +
          `or paste the update command in Terminal:\n\n${INSTALL_COMMAND}`
        : `You have version ${this.currentVersion}. Download the new version from the release page.`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    });
    if (response === 0) void shell.openExternal(releaseUrl(version));
    if (mac && response === 1) {
      clipboard.writeText(INSTALL_COMMAND);
      this.notify('Update command copied', 'Paste it in Terminal and press Return.');
    }
  }

  /** Windows and AppImage: the new version is downloaded. */
  private async offerRestart(version: string): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: `Big Eyes ${version} is ready to install`,
      detail: 'Restart Big Eyes now to finish the update, or it will be installed the next time Big Eyes quits.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }

  /** Runs the right action for the tray menu item "Update available…". */
  act(): void {
    const s = this.state;
    if (s.kind === 'ready') void this.offerRestart(s.version);
    else if (s.kind === 'available') void this.offerManualUpdate(s.version);
    else if (s.kind === 'downloading') this.notify(`Downloading Big Eyes ${s.version}`, `${s.percent}% done.`);
    else void this.check(true);
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body, silent: true }).show();
  }

  private set(state: UpdateState): void {
    this.state = state;
    this.hooks.onState(state);
  }
}

/** Short text for the tray menu, or null when nothing should be shown. */
export function updateMenuLabel(state: UpdateState): string | null {
  switch (state.kind) {
    case 'available':
      return `Update Available: ${state.version}…`;
    case 'downloading':
      return `Downloading Update ${state.version} (${state.percent}%)`;
    case 'ready':
      return `Restart to Update to ${state.version}`;
    default:
      return null;
  }
}
