/**
 * Update logic that does not depend on Electron, so it can be unit tested.
 *
 * How Big Eyes updates on each system (the common approach for Electron apps on GitHub Releases):
 * - Windows installer (NSIS) and Linux AppImage: electron-updater downloads the new version in the
 *   background and installs it when the user chooses "Restart now" (or on the next quit).
 * - macOS: automatic install needs an Apple Developer ID signature. Our builds are ad-hoc signed, so the
 *   app tells the user and offers the release page and the one-line update command instead.
 * - Linux .deb and running from source: tell the user, offer the release page.
 */

export const REPO_URL = 'https://github.com/eranra/big-eyes';
export const RELEASES_URL = `${REPO_URL}/releases`;
export const ISSUES_URL = `${REPO_URL}/issues`;
export const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/eranra/big-eyes/main/install.sh | bash';

/** How this copy of the app can be updated. */
export type UpdateChannel =
  /** electron-updater downloads and installs it (Windows NSIS, Linux AppImage). */
  | 'auto'
  /** Tell the user and offer the release page and the install command (macOS). */
  | 'notify-mac'
  /** Tell the user and offer the release page (Linux .deb, unknown packages). */
  | 'notify'
  /** Development run (`npm start`): no update checks. */
  | 'none';

export interface InstallInfo {
  platform: NodeJS.Platform;
  /** `app.isPackaged`. */
  packaged: boolean;
  /** Set when running from an AppImage (`process.env.APPIMAGE`). */
  appImage?: string | undefined;
}

export function updateChannel(info: InstallInfo): UpdateChannel {
  if (!info.packaged) return 'none';
  if (info.platform === 'win32') return 'auto';
  if (info.platform === 'darwin') return 'notify-mac';
  if (info.platform === 'linux' && info.appImage) return 'auto';
  return 'notify';
}

/** Parses "1.2.3", "v1.2.3" or "1.2.3-beta.1" into numbers. Returns null for anything else. */
export function parseVersion(text: string): { parts: [number, number, number]; pre: string | null } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return null;
  return { parts: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

/** Compares two versions: negative if a < b, 0 if equal, positive if a > b. Invalid versions sort lowest. */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    const d = va.parts[i]! - vb.parts[i]!;
    if (d !== 0) return d;
  }
  // A release (no "-beta") is newer than its pre-release.
  if (va.pre === vb.pre) return 0;
  if (va.pre === null) return 1;
  if (vb.pre === null) return -1;
  return va.pre < vb.pre ? -1 : 1;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version.replace(/^v/, '')}`;
}

/** Hours between automatic update checks. */
export const UPDATE_CHECK_HOURS = 6;
/** Seconds after start before the first automatic check, so start-up stays quick. */
export const FIRST_CHECK_DELAY_SECONDS = 10;

/**
 * Whether to tell the user about `latest`. Automatic checks announce each new version once.
 * A manual "Check for Updates…" always tells the user, also "You are up to date".
 */
export function shouldAnnounce(latest: string, current: string, lastAnnounced: string | null, manual: boolean): boolean {
  if (!isNewer(latest, current)) return false;
  if (manual) return true;
  return lastAnnounced === null || isNewer(latest, lastAnnounced);
}

/** Name of the update metadata file electron-builder publishes for each system. */
export function metadataFileName(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'latest-mac.yml';
  if (platform === 'linux') return 'latest-linux.yml';
  return 'latest.yml';
}

/** Always points at the newest published (not draft) release. */
export function latestMetadataUrl(platform: NodeJS.Platform): string {
  return `${RELEASES_URL}/latest/download/${metadataFileName(platform)}`;
}

/** Reads `version:` from an electron-builder `latest*.yml` file. Returns null when it is missing or invalid. */
export function versionFromMetadata(yaml: string): string | null {
  const m = /^version:\s*['"]?([^'"\s]+)['"]?\s*$/m.exec(yaml);
  return m && parseVersion(m[1]!) ? m[1]! : null;
}
