import type { FaceObservation } from './face';
import type { GazeReference, Settings } from './settings';

/** IPC channel names shared by main, preload and renderer. */
export const IPC = {
  /** main -> renderer: current settings (sent on change). */
  settings: 'big-eyes:settings',
  /** main -> overlay: show / hide animation. */
  visibility: 'big-eyes:visibility',
  /** main -> overlay: start calibration. */
  calibrate: 'big-eyes:calibrate',
  /** overlay (tracker window) -> main: faces from one frame, forwarded to all overlays. */
  faces: 'big-eyes:faces',
  /** main -> overlays: faces from the tracker. */
  facesBroadcast: 'big-eyes:faces-broadcast',
  /** renderer -> main: calibration result. */
  calibrated: 'big-eyes:calibrated',
  /** renderer -> main (invoke): get settings. */
  getSettings: 'big-eyes:get-settings',
  /** renderer -> main (invoke): merge a partial settings update. */
  updateSettings: 'big-eyes:update-settings',
  /** renderer -> main (invoke): reset settings to defaults. */
  resetSettings: 'big-eyes:reset-settings',
  /** renderer -> main: list of cameras found by the renderer. */
  cameras: 'big-eyes:cameras',
  /** renderer -> main (invoke): list of displays. */
  getDisplays: 'big-eyes:get-displays',
  /** renderer -> main: a status or error message for the user. */
  status: 'big-eyes:status',
  /** settings window -> main: show a preview of the eyes now. */
  preview: 'big-eyes:preview',
  /** overlay -> main: where the eyes are now, in window coordinates (CSS pixels). */
  eyeArea: 'big-eyes:eye-area',
  /** main -> tracker overlay: open the camera for a short presence check (true) or stop it (false). */
  presenceCheck: 'big-eyes:presence-check',
  /** tracker overlay -> main: faces seen during a presence check, or an error. */
  presenceFaces: 'big-eyes:presence-faces',
  /** overlay -> main: the eyes finished look-to-close; hide them. */
  requestClose: 'big-eyes:request-close',
  /** about window -> main (invoke): app version, platform, update state. */
  getAbout: 'big-eyes:get-about',
  /** main -> about window: update state changed. */
  aboutUpdate: 'big-eyes:about-update',
  /** about window -> main: check for updates now. */
  checkUpdates: 'big-eyes:check-updates',
  /** about / settings window -> main: open one of our GitHub links in the browser. */
  openLink: 'big-eyes:open-link',
  /** settings window -> main: start eye contact calibration. */
  requestCalibrate: 'big-eyes:request-calibrate',
} as const;

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  arch: string;
  /** How updates work on this system, in one sentence. */
  updateMode: string;
  /** Short update status text, for example "You're up to date" or "Version 0.3.0 is available". */
  updateStatus: string;
  repoUrl: string;
  license: string;
  author: string;
}

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface DisplaySummary {
  id: number;
  label: string;
  primary: boolean;
  /** Built-in laptop screen. */
  internal: boolean;
  width: number;
  height: number;
}

/** Role of an overlay window. One window per screen; only the tracker window uses the camera. */
export interface OverlayRole {
  displayId: number;
  isTracker: boolean;
  /** Testing aid: the eyes show step-by-step instructions and log each step. */
  guidedTest?: boolean;
}

export interface FacesMessage {
  faces: FaceObservation[];
  /** Time in seconds (performance.now based, on the tracker side). */
  time: number;
}

/** The API exposed to renderer code by the preload script, as `window.bigEyes`. */
export interface BigEyesApi {
  role: OverlayRole | null;
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings> | Record<string, unknown>): Promise<Settings>;
  resetSettings(): Promise<Settings>;
  getDisplays(): Promise<DisplaySummary[]>;
  onSettings(listener: (settings: Settings) => void): void;
  onVisibility(listener: (visible: boolean) => void): void;
  onCalibrate(listener: () => void): void;
  onFaces(listener: (message: FacesMessage) => void): void;
  onPresenceCheck(listener: (active: boolean) => void): void;
  sendPresenceFaces(message: { faces: FacesMessage['faces']; error?: string }): void;
  onStatus(listener: (message: string) => void): void;
  sendFaces(message: FacesMessage): void;
  sendCameras(cameras: CameraInfo[]): void;
  sendCalibrated(reference: GazeReference): void;
  sendStatus(message: string): void;
  sendEyeArea(rect: { x: number; y: number; width: number; height: number }): void;
  requestClose(): void;
  preview(): void;
  getAbout(): Promise<AboutInfo>;
  onAboutUpdate(listener: (info: AboutInfo) => void): void;
  checkUpdates(): void;
  openLink(url: string): void;
  calibrate(): void;
}
