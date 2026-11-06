import { clamp, type Vec2 } from './math';

/** A camera saved in the settings. The id can change (for example after plugging in again), so the name is kept too. */
export interface SavedCamera {
  id: string;
  label: string;
}

/** Which cameras watch for people. */
export type CameraChoice =
  /** The computer's own camera (FaceTime / MacBook / "Integrated"), else the system default. */
  | { mode: 'builtin' }
  /** Whatever camera the system offers first. */
  | { mode: 'default' }
  /** Every connected camera. */
  | { mode: 'all' }
  /** The chosen cameras. The first one is the main camera (the eyes follow what it sees). */
  | { mode: 'selected'; cameras: SavedCamera[] };

/** Which screens show the eyes. */
export type ScreenChoice =
  /** The laptop's built-in screen. Falls back to the main screen when there is none (desktop Macs, PCs). */
  | { mode: 'builtin' }
  | { mode: 'all' }
  | { mode: 'primary' }
  /** Specific displays by id. Falls back to the primary display if none of them is connected. */
  | { mode: 'selected'; ids: number[] };

/** Gaze values recorded while the person looks at the eyes. Set by "Calibrate". */
export interface GazeReference {
  yaw: number;
  pitch: number;
  gaze: Vec2;
}

/**
 * Calibration of one camera: what "looking at the eyes" looks like from where this camera sits.
 * Saved by camera name and id, so it is found again after the camera is unplugged and plugged back in.
 */
export interface CameraCalibration {
  /** Camera name, for example "MacBook Pro Camera (0000:0001)". */
  label: string;
  /** Camera device id when calibrated. Ids can change; the name is used when the id is not found. */
  id: string;
  reference: GazeReference;
  /** Where the face was in this camera's picture when calibrated (0..1, origin top-left). */
  faceCenter: Vec2;
  /** ISO date of the calibration. */
  date: string;
}

export interface AttentionSettings {
  reference: GazeReference;
  /** Allowed head yaw difference from the reference, degrees. */
  yawTolerance: number;
  /** Allowed head pitch difference from the reference, degrees. */
  pitchTolerance: number;
  /** Allowed eye direction difference from the reference (eye direction range is -1..1). */
  gazeTolerance: number;
  /** Weight of the eye direction term compared to head angles. */
  gazeWeight: number;
  /** Seconds without a face before the person counts as gone. */
  absenceGrace: number;
  /** Smoothing time constant for the eye contact score, seconds. */
  contactSmoothing: number;
  /** Smoothing time constant for the face position, seconds. */
  positionSmoothing: number;
}

export interface MoodSettings {
  /** Eye contact must last this long (s) before the eyes smile. */
  contactToHappy: number;
  /** After eye contact stops, the eyes stay happy this long (s). */
  happyHold: number;
  /** Not looking at the eyes this long (s) makes them bored. */
  awayToBored: number;
  /** Length (s) of the surprised look when a person appears. */
  surpriseDuration: number;
  /** Nobody in front of the camera this long (s) makes the eyes fall asleep. */
  absentToSleep: number;
  /** Smile back: when the person smiles at the eyes, they smile back (the "delighted" mood). */
  smileBack: boolean;
  /** The person must smile this long (s) before the eyes smile back. */
  smileToDelighted: number;
  /** After the person stops smiling, the eyes keep smiling this long (s). */
  delightedHold: number;
}

/** Where the eyes sit on the screen. */
export type EyePosition = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * What mouse movement does while the eyes are shown. Key presses and clicks always close the eyes.
 * - 'onto-eyes': moving the pointer onto the eyes closes them; moving elsewhere is fine.
 * - 'any': any mouse movement closes them.
 * - 'never': mouse movement never closes them; press a key or click.
 */
export type MouseRule = 'onto-eyes' | 'any' | 'never';

/**
 * What happens with the system screen saver.
 * - 'pause': while the screen saver runs, the eyes stay away (default).
 * - 'replace': Big Eyes keeps the screen saver from starting; the eyes appear instead.
 */
export type ScreenSaverMode = 'pause' | 'replace';

/**
 * Blur the screen behind the eyes.
 * - 'off': no blur (the background dim setting still applies).
 * - 'screensaver': blur only when the eyes replace the screen saver (default).
 * - 'always': blur every time the eyes appear.
 */
export type BlurMode = 'off' | 'screensaver' | 'always';

export interface BlinkSettings {
  /** How often the eyes blink: 0 = never, 1 = normal (every 2-5 s), 3 = very often. */
  rate: number;
  /** How fast one blink is: 0.4 = slow and sleepy, 1 = normal, 2 = very quick. */
  speed: number;
}

export interface Settings {
  /** Seconds without keyboard or mouse input before the eyes appear. */
  idleTimeout: number;
  /** Where the eyes sit on the screen. */
  position: EyePosition;
  /**
   * Do not show the eyes while someone looks at the screen, even without keyboard or mouse input
   * (for example while reading). Uses a short camera check when the idle time is reached.
   */
  waitWhileWatched: boolean;
  /** What happens with the system screen saver. */
  screenSaver: ScreenSaverMode;
  /** Blur the screen behind the eyes. */
  blur: BlurMode;
  /**
   * Minutes of no input after which the screen saver would start ("replace" mode: when the blur starts).
   * 0 = use the system: the macOS screen saver time if set, else the display sleep time.
   */
  screenSaverMinutes: number;
  /** Blur strength, 0.3 (light) .. 1 (strong: nothing readable behind). */
  blurStrength: number;
  /** What mouse movement does while the eyes are shown. */
  mouseRule: MouseRule;
  /** Close the eyes when the person keeps looking into them for `lookToCloseSeconds`. */
  lookToClose: boolean;
  /** Seconds of eye contact before the eyes close, when `lookToClose` is on. */
  lookToCloseSeconds: number;
  blink: BlinkSettings;
  /** Eye size multiplier. 1 = default (eyes about 1/4 of the screen height). */
  eyeSize: number;
  /** Which screens show the eyes. */
  screens: ScreenChoice;
  /** Which cameras watch for people. */
  cameras: CameraChoice;
  /** One calibration per camera. */
  calibrations: CameraCalibration[];
  /** How dark the screen behind the eyes gets, 0 (fully transparent over your apps) .. 0.95. */
  backgroundDim: number;
  /** Iris color as a CSS hex color, for example "#3d85dc". */
  irisColor: string;
  /** How the eyes look, apart from the iris color. */
  look: LookSettings;
  /** Text shown when you make eye contact. */
  welcomeText: string;
  /** Text shown when you look away for a while. */
  boredText: string;
  /** Show the texts at all. */
  showCaptions: boolean;
  /** Flip left/right if the camera delivers mirrored images. */
  mirrorCamera: boolean;
  /** macOS: do not appear while an app keeps the display awake (videos, presentations). */
  respectVideoPlayback: boolean;
  /** Start the app when you log in. */
  openAtLogin: boolean;
  /** Show tracking numbers on screen, for tuning. */
  showDebugInfo: boolean;
  /** Check GitHub for new versions at start and every few hours. */
  checkForUpdates: boolean;
  /** The newest version the user was already told about, so it is not announced again. */
  lastAnnouncedVersion: string | null;
  /** Stop showing the eyes until resumed. */
  paused: boolean;
  attention: AttentionSettings;
  mood: MoodSettings;
}

/** Iris drawing style. */
export type IrisStyle = 'detailed' | 'simple' | 'glow';
/** Overall eye outline. */
export type EyeShape = 'round' | 'tall' | 'wide';

export interface LookSettings {
  /** Color of the eye white. */
  scleraColor: string;
  /** Color of the eyelids (the skin around the eye). */
  lidColor: string;
  /** Color of the eyebrows. */
  browColor: string;
  /** Color of the lash line and lashes. */
  lashColor: string;
  /** Color of the soft light behind the eyes. */
  glowColor: string;
  /** Strength of the light behind the eyes, 0..1. */
  glowStrength: number;
  irisStyle: IrisStyle;
  /** Iris size relative to the eye, 0.6..1.4. 1 = default. */
  irisSize: number;
  /** Pupil size relative to the iris, 0.5..1.6. 1 = default. */
  pupilSize: number;
  /** 'round' like people, 'slit' like a cat. */
  pupilShape: 'round' | 'slit';
  eyeShape: EyeShape;
  /** Distance between the eyes, 0.8..1.5. 1 = default. */
  spacing: number;
  showBrows: boolean;
  showLashes: boolean;
  /** Pink cheeks when the eyes smile. */
  showBlush: boolean;
  /** A mouth under the eyes. It smiles back when you smile. */
  showMouth: boolean;
  /** Color of the lips. */
  mouthColor: string;
}

/** Ready-made looks. Each one sets the iris color and the whole `look`. */
export const THEMES: ReadonlyArray<{ id: string; label: string; irisColor: string; look: LookSettings }> = [
  {
    id: 'classic',
    label: 'Classic',
    irisColor: '#3d85dc',
    look: {
      scleraColor: '#ffffff',
      lidColor: '#5c4f6e',
      browColor: '#9e8fb3',
      lashColor: '#120d1a',
      glowColor: '#3d85dc',
      glowStrength: 0.5,
      irisStyle: 'detailed',
      irisSize: 1,
      pupilSize: 1,
      pupilShape: 'round',
      eyeShape: 'round',
      spacing: 1,
      showBrows: true,
      showLashes: true,
      showBlush: true,
      showMouth: true,
      mouthColor: '#d9667f',
    },
  },
  {
    id: 'cartoon',
    label: 'Cartoon',
    irisColor: '#2b2b2b',
    look: {
      scleraColor: '#ffffff',
      lidColor: '#f2c9a0',
      browColor: '#3a2a1e',
      lashColor: '#1a1a1a',
      glowColor: '#ffd27a',
      glowStrength: 0.25,
      irisStyle: 'simple',
      irisSize: 0.85,
      pupilSize: 1.4,
      pupilShape: 'round',
      eyeShape: 'tall',
      spacing: 1,
      showBrows: true,
      showLashes: false,
      showBlush: true,
      showMouth: true,
      mouthColor: '#5a2e1e',
    },
  },
  {
    id: 'robot',
    label: 'Robot',
    irisColor: '#29e3ff',
    look: {
      scleraColor: '#0d1b24',
      lidColor: '#3a4650',
      browColor: '#6a7a86',
      lashColor: '#0a0f14',
      glowColor: '#29e3ff',
      glowStrength: 0.9,
      irisStyle: 'glow',
      irisSize: 0.9,
      pupilSize: 0.7,
      pupilShape: 'round',
      eyeShape: 'wide',
      spacing: 1.1,
      showBrows: false,
      showLashes: false,
      showBlush: false,
      showMouth: true,
      mouthColor: '#29e3ff',
    },
  },
  {
    id: 'cat',
    label: 'Cat',
    irisColor: '#9ccc3c',
    look: {
      scleraColor: '#fdf6dc',
      lidColor: '#4a3b30',
      browColor: '#7a6650',
      lashColor: '#1c140e',
      glowColor: '#c8e66a',
      glowStrength: 0.45,
      irisStyle: 'detailed',
      irisSize: 1.3,
      pupilSize: 1.2,
      pupilShape: 'slit',
      eyeShape: 'wide',
      spacing: 1.05,
      showBrows: false,
      showLashes: true,
      showBlush: false,
      showMouth: true,
      mouthColor: '#3a2a22',
    },
  },
  {
    id: 'spooky',
    label: 'Spooky',
    irisColor: '#e0312b',
    look: {
      scleraColor: '#f3ead2',
      lidColor: '#2a1c22',
      browColor: '#4d3540',
      lashColor: '#000000',
      glowColor: '#ff3b2f',
      glowStrength: 0.8,
      irisStyle: 'glow',
      irisSize: 0.9,
      pupilSize: 0.6,
      pupilShape: 'round',
      eyeShape: 'round',
      spacing: 1,
      showBrows: true,
      showLashes: true,
      showBlush: false,
      showMouth: true,
      mouthColor: '#8a1c1c',
    },
  },
];

export const IRIS_STYLES: ReadonlyArray<{ label: string; value: IrisStyle }> = [
  { label: 'Detailed', value: 'detailed' },
  { label: 'Simple', value: 'simple' },
  { label: 'Glowing', value: 'glow' },
];

export const PUPIL_SHAPES: ReadonlyArray<{ label: string; value: LookSettings['pupilShape'] }> = [
  { label: 'Round', value: 'round' },
  { label: 'Slit (cat)', value: 'slit' },
];

export const EYE_SHAPES: ReadonlyArray<{ label: string; value: EyeShape }> = [
  { label: 'Round', value: 'round' },
  { label: 'Tall', value: 'tall' },
  { label: 'Wide', value: 'wide' },
];

/** Id of the theme that matches the current look exactly, or null for a custom look. */
export function matchingTheme(settings: Pick<Settings, 'irisColor' | 'look'>): string | null {
  const same = (a: LookSettings, b: LookSettings): boolean => JSON.stringify(a) === JSON.stringify(b);
  return THEMES.find((t) => t.irisColor === settings.irisColor && same(t.look, settings.look))?.id ?? null;
}

export const POSITIONS: ReadonlyArray<{ label: string; value: EyePosition }> = [
  { label: 'Center', value: 'center' },
  { label: 'Top Left', value: 'top-left' },
  { label: 'Top Right', value: 'top-right' },
  { label: 'Bottom Left', value: 'bottom-left' },
  { label: 'Bottom Right', value: 'bottom-right' },
];

export const MOUSE_RULES: ReadonlyArray<{ label: string; value: MouseRule }> = [
  { label: 'Moving onto the eyes closes them', value: 'onto-eyes' },
  { label: 'Any mouse movement closes them', value: 'any' },
  { label: 'Mouse movement never closes them', value: 'never' },
];

export const SCREEN_SAVER_MODES: ReadonlyArray<{ label: string; value: ScreenSaverMode }> = [
  { label: 'Pause the eyes during the screen saver', value: 'pause' },
  { label: 'Eyes replace the screen saver', value: 'replace' },
];

export const BLUR_MODES: ReadonlyArray<{ label: string; value: BlurMode }> = [
  { label: 'Off', value: 'off' },
  { label: 'When Replacing the Screen Saver', value: 'screensaver' },
  { label: 'Always', value: 'always' },
];

export const SCREEN_SAVER_TIME_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Same as the System', value: 0 },
  { label: '5 minutes', value: 5 },
  { label: '10 minutes', value: 10 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
];

/** Used when the system has no screen saver time and no display sleep time. */
export const FALLBACK_SCREEN_SAVER_MINUTES = 10;

/**
 * Seconds of no input after which the screen saver would start.
 * @param systemSeconds the system's screen saver time, or else display sleep time, in seconds (0 or null = none).
 */
export function screenSaverSeconds(s: Pick<Settings, 'screenSaverMinutes'>, systemSeconds: number | null): number {
  if (s.screenSaverMinutes > 0) return s.screenSaverMinutes * 60;
  if (systemSeconds && systemSeconds > 0) return systemSeconds;
  return FALLBACK_SCREEN_SAVER_MINUTES * 60;
}

/**
 * Whether the screen behind the eyes is blurred now.
 * - 'always': whenever the eyes are shown.
 * - 'screensaver': only in "replace" mode, and only once the idle time reached the screen saver time;
 *   the normal eyes before that are not blurred.
 */
export function blurActive(
  s: Pick<Settings, 'blur' | 'screenSaver' | 'screenSaverMinutes'>,
  idleSeconds: number,
  systemScreenSaverSeconds: number | null,
): boolean {
  if (s.blur === 'always') return true;
  if (s.blur !== 'screensaver' || s.screenSaver !== 'replace') return false;
  return idleSeconds >= screenSaverSeconds(s, systemScreenSaverSeconds);
}

export const BLINK_RATE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Never', value: 0 },
  { label: 'Rarely', value: 0.4 },
  { label: 'Normal', value: 1 },
  { label: 'Often', value: 2 },
];

export const BLINK_SPEED_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Slow', value: 0.5 },
  { label: 'Normal', value: 1 },
  { label: 'Quick', value: 1.6 },
];

export const LOOK_TO_CLOSE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '1 second', value: 1 },
  { label: '2 seconds', value: 2 },
  { label: '3 seconds', value: 3 },
  { label: '5 seconds', value: 5 },
];

export const EYE_SIZE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'Very Small', value: 0.35 },
  { label: 'Small', value: 0.6 },
  { label: 'Medium', value: 1 },
  { label: 'Large', value: 1.35 },
  { label: 'Huge', value: 1.7 },
];

export const IDLE_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: '15 seconds', value: 15 },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '2 minutes', value: 120 },
  { label: '5 minutes', value: 300 },
  { label: '10 minutes', value: 600 },
];

export const IRIS_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Blue', value: '#3d85dc' },
  { label: 'Green', value: '#4d9e61' },
  { label: 'Brown', value: '#7f522e' },
  { label: 'Hazel', value: '#947f42' },
  { label: 'Gray', value: '#808f9e' },
  { label: 'Violet', value: '#8c61d9' },
];

export function defaultSettings(): Settings {
  return {
    idleTimeout: 30,
    position: 'center',
    waitWhileWatched: true,
    screenSaver: 'pause',
    blur: 'screensaver',
    screenSaverMinutes: 0,
    blurStrength: 1,
    mouseRule: 'onto-eyes',
    lookToClose: false,
    lookToCloseSeconds: 2,
    blink: { rate: 1, speed: 1 },
    eyeSize: 1,
    screens: { mode: 'builtin' },
    cameras: { mode: 'builtin' },
    calibrations: [],
    backgroundDim: 0.35,
    irisColor: THEMES[0]!.irisColor,
    look: { ...THEMES[0]!.look },
    welcomeText: 'Welcome',
    boredText: 'Bored',
    showCaptions: false,
    mirrorCamera: false,
    respectVideoPlayback: true,
    openAtLogin: false,
    showDebugInfo: false,
    checkForUpdates: true,
    lastAnnouncedVersion: null,
    paused: false,
    attention: {
      // The camera sits above the screen, so people look slightly down when they look at the screen.
      // Measured with MediaPipe on a MacBook Pro: looking at the screen gives pitch about +10 degrees and
      // gaze y about +0.2. "Calibrate" replaces these values with your own.
      reference: { yaw: 0, pitch: 10, gaze: { x: 0, y: 0.2 } },
      yawTolerance: 15,
      pitchTolerance: 14,
      gazeTolerance: 0.45,
      gazeWeight: 0.8,
      absenceGrace: 1.2,
      contactSmoothing: 0.22,
      positionSmoothing: 0.12,
    },
    mood: {
      contactToHappy: 0.45,
      happyHold: 0.7,
      awayToBored: 2.5,
      surpriseDuration: 0.9,
      absentToSleep: 8,
      smileBack: true,
      smileToDelighted: 0.3,
      delightedHold: 1.2,
    },
  };
}

// ---- Validation ---------------------------------------------------------------------------------
// Settings come from a JSON file the user can edit and from the settings window. Never trust them:
// every value is checked and replaced by the default when it is missing or invalid.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number, low: number, high: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, low, high) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function text(v: unknown, fallback: string, maxLength = 40): string {
  return typeof v === 'string' ? v.slice(0, maxLength) : fallback;
}


function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : fallback;
}

function vec2(v: unknown, fallback: Vec2, limit: number): Vec2 {
  if (!isObj(v)) return fallback;
  return { x: num(v.x, fallback.x, -limit, limit), y: num(v.y, fallback.y, -limit, limit) };
}

function calibrations(s: Obj): CameraCalibration[] {
  const list = Array.isArray(s.calibrations) ? s.calibrations : [];
  const out: CameraCalibration[] = [];
  for (const c of list) {
    if (!isObj(c) || typeof c.label !== 'string' || !c.label) continue;
    const ref = isObj(c.reference) ? c.reference : {};
    const d = defaultSettings().attention.reference;
    out.push({
      label: c.label.slice(0, 256),
      id: typeof c.id === 'string' ? c.id.slice(0, 256) : '',
      reference: {
        yaw: num(ref.yaw, d.yaw, -90, 90),
        pitch: num(ref.pitch, d.pitch, -90, 90),
        gaze: vec2(ref.gaze, d.gaze, 1),
      },
      faceCenter: vec2(c.faceCenter, { x: 0.5, y: 0.5 }, 1),
      date: typeof c.date === 'string' ? c.date.slice(0, 40) : '',
    });
  }
  // One calibration per camera name (the newest wins), at most 16.
  const byLabel = new Map<string, CameraCalibration>();
  for (const c of out) byLabel.set(c.label, c);
  return [...byLabel.values()].slice(-16);
}

/** The saved calibration for a camera, by id first, then by name. Null if this camera was never calibrated. */
export function findCalibration(list: readonly CameraCalibration[], camera: { id?: string; label: string }): CameraCalibration | null {
  return (camera.id ? list.find((c) => c.id === camera.id) : undefined) ?? list.find((c) => c.label === camera.label) ?? null;
}

/** Adds or replaces the calibration of one camera. */
export function withCalibration(list: readonly CameraCalibration[], c: CameraCalibration): CameraCalibration[] {
  return [...list.filter((x) => x.label !== c.label && (!c.id || x.id !== c.id)), c];
}

function savedCamera(v: unknown): SavedCamera | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.label !== 'string') return null;
  if (!v.id && !v.label) return null;
  return { id: v.id.slice(0, 256), label: v.label.slice(0, 256) };
}

/**
 * Reads the camera choice. Also converts settings files from version 0.1.0, which had
 * `cameraKind` ('builtin' | 'default') plus an optional `cameraId` / `cameraLabel`.
 */
function cameraChoice(s: Obj, fallback: CameraChoice): CameraChoice {
  const v = s.cameras;
  if (isObj(v)) {
    if (v.mode === 'builtin' || v.mode === 'default' || v.mode === 'all') return { mode: v.mode };
    if (v.mode === 'selected' && Array.isArray(v.cameras)) {
      const seen = new Set<string>();
      const cameras = v.cameras
        .map(savedCamera)
        .filter((c): c is SavedCamera => c !== null && !seen.has(c.id || c.label) && Boolean(seen.add(c.id || c.label)))
        .slice(0, 8);
      return cameras.length ? { mode: 'selected', cameras } : fallback;
    }
    return fallback;
  }
  // Version 0.1.0 settings.
  const id = typeof s.cameraId === 'string' ? s.cameraId : '';
  const label = typeof s.cameraLabel === 'string' ? s.cameraLabel : '';
  if (id || label) return { mode: 'selected', cameras: [{ id: id.slice(0, 256), label: label.slice(0, 256) }] };
  if (s.cameraKind === 'default') return { mode: 'default' };
  if (s.cameraKind === 'builtin') return { mode: 'builtin' };
  return fallback;
}

function screens(v: unknown, fallback: ScreenChoice): ScreenChoice {
  if (!isObj(v)) return fallback;
  if (v.mode === 'all' || v.mode === 'primary' || v.mode === 'builtin') return { mode: v.mode };
  if (v.mode === 'selected' && Array.isArray(v.ids)) {
    const ids = [...new Set(v.ids.filter((id): id is number => Number.isInteger(id)))].slice(0, 16);
    return ids.length ? { mode: 'selected', ids } : fallback;
  }
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function look(v: unknown, d: LookSettings): LookSettings {
  const l = isObj(v) ? v : {};
  return {
    scleraColor: color(l.scleraColor, d.scleraColor),
    lidColor: color(l.lidColor, d.lidColor),
    browColor: color(l.browColor, d.browColor),
    lashColor: color(l.lashColor, d.lashColor),
    glowColor: color(l.glowColor, d.glowColor),
    glowStrength: num(l.glowStrength, d.glowStrength, 0, 1),
    irisStyle: oneOf(l.irisStyle, ['detailed', 'simple', 'glow'] as const, d.irisStyle),
    irisSize: num(l.irisSize, d.irisSize, 0.6, 1.4),
    pupilSize: num(l.pupilSize, d.pupilSize, 0.5, 1.6),
    pupilShape: oneOf(l.pupilShape, ['round', 'slit'] as const, d.pupilShape),
    eyeShape: oneOf(l.eyeShape, ['round', 'tall', 'wide'] as const, d.eyeShape),
    spacing: num(l.spacing, d.spacing, 0.8, 1.5),
    showBrows: bool(l.showBrows, d.showBrows),
    showLashes: bool(l.showLashes, d.showLashes),
    showBlush: bool(l.showBlush, d.showBlush),
    showMouth: bool(l.showMouth, d.showMouth),
    mouthColor: color(l.mouthColor, d.mouthColor),
  };
}

/** Returns valid settings built from any input. Unknown keys are dropped. */
export function normalizeSettings(input: unknown): Settings {
  const d = defaultSettings();
  const s = isObj(input) ? input : {};
  const a = isObj(s.attention) ? s.attention : {};
  const ref = isObj(a.reference) ? a.reference : {};
  const m = isObj(s.mood) ? s.mood : {};
  const da = d.attention;
  const dm = d.mood;
  return {
    idleTimeout: num(s.idleTimeout, d.idleTimeout, 5, 24 * 3600),
    waitWhileWatched: bool(s.waitWhileWatched, d.waitWhileWatched),
    screenSaver: oneOf(s.screenSaver, ['pause', 'replace'] as const, d.screenSaver),
    blur: oneOf(s.blur, ['off', 'screensaver', 'always'] as const, d.blur),
    screenSaverMinutes: Math.round(num(s.screenSaverMinutes, d.screenSaverMinutes, 0, 600)),
    blurStrength: num(s.blurStrength, d.blurStrength, 0.3, 1),
    position: oneOf(s.position, ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const, d.position),
    mouseRule: oneOf(s.mouseRule, ['onto-eyes', 'any', 'never'] as const, d.mouseRule),
    lookToClose: bool(s.lookToClose, d.lookToClose),
    lookToCloseSeconds: num(s.lookToCloseSeconds, d.lookToCloseSeconds, 0.5, 30),
    blink: {
      rate: num(isObj(s.blink) ? s.blink.rate : undefined, d.blink.rate, 0, 3),
      speed: num(isObj(s.blink) ? s.blink.speed : undefined, d.blink.speed, 0.3, 2.5),
    },
    eyeSize: num(s.eyeSize, d.eyeSize, 0.2, 2.5),
    screens: screens(s.screens, d.screens),
    cameras: cameraChoice(s, d.cameras),
    calibrations: calibrations(s),
    backgroundDim: num(s.backgroundDim, d.backgroundDim, 0, 0.95),
    irisColor: color(s.irisColor, d.irisColor),
    look: look(s.look, d.look),
    welcomeText: text(s.welcomeText, d.welcomeText),
    boredText: text(s.boredText, d.boredText),
    showCaptions: bool(s.showCaptions, d.showCaptions),
    mirrorCamera: bool(s.mirrorCamera, d.mirrorCamera),
    respectVideoPlayback: bool(s.respectVideoPlayback, d.respectVideoPlayback),
    openAtLogin: bool(s.openAtLogin, d.openAtLogin),
    showDebugInfo: bool(s.showDebugInfo, d.showDebugInfo),
    checkForUpdates: bool(s.checkForUpdates, d.checkForUpdates),
    lastAnnouncedVersion:
      typeof s.lastAnnouncedVersion === 'string' && /^v?\d+\.\d+\.\d+/.test(s.lastAnnouncedVersion)
        ? s.lastAnnouncedVersion.slice(0, 40)
        : d.lastAnnouncedVersion,
    paused: bool(s.paused, d.paused),
    attention: {
      reference: {
        yaw: num(ref.yaw, da.reference.yaw, -60, 60),
        pitch: num(ref.pitch, da.reference.pitch, -60, 60),
        gaze: vec2(ref.gaze, da.reference.gaze, 1),
      },
      yawTolerance: num(a.yawTolerance, da.yawTolerance, 2, 60),
      pitchTolerance: num(a.pitchTolerance, da.pitchTolerance, 2, 60),
      gazeTolerance: num(a.gazeTolerance, da.gazeTolerance, 0.05, 2),
      gazeWeight: num(a.gazeWeight, da.gazeWeight, 0, 3),
      absenceGrace: num(a.absenceGrace, da.absenceGrace, 0, 10),
      contactSmoothing: num(a.contactSmoothing, da.contactSmoothing, 0, 2),
      positionSmoothing: num(a.positionSmoothing, da.positionSmoothing, 0, 2),
    },
    mood: {
      contactToHappy: num(m.contactToHappy, dm.contactToHappy, 0, 10),
      happyHold: num(m.happyHold, dm.happyHold, 0, 10),
      awayToBored: num(m.awayToBored, dm.awayToBored, 0, 60),
      surpriseDuration: num(m.surpriseDuration, dm.surpriseDuration, 0, 5),
      absentToSleep: num(m.absentToSleep, dm.absentToSleep, 0, 600),
      smileBack: bool(m.smileBack, dm.smileBack),
      smileToDelighted: num(m.smileToDelighted, dm.smileToDelighted, 0, 5),
      delightedHold: num(m.delightedHold, dm.delightedHold, 0, 10),
    },
  };
}

/** Deep-merges a partial update into settings, then validates the result. */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  if (!isObj(patch)) return current;
  const merged: Obj = { ...current, ...patch };
  if (isObj(patch.attention)) {
    const pa = patch.attention;
    merged.attention = {
      ...current.attention,
      ...pa,
      reference: isObj(pa.reference) ? { ...current.attention.reference, ...pa.reference } : current.attention.reference,
    };
  }
  if (isObj(patch.mood)) merged.mood = { ...current.mood, ...patch.mood };
  if (isObj(patch.look)) merged.look = { ...current.look, ...patch.look };
  if (isObj(patch.blink)) merged.blink = { ...current.blink, ...patch.blink };
  return normalizeSettings(merged);
}

/** Minimal display description, compatible with Electron's `Display`. */
export interface DisplayInfo {
  id: number;
  label?: string;
  /** True for a laptop's built-in screen (Electron `Display.internal`). */
  internal?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Screens that get only the blur (no eyes): every connected screen that does not show the eyes.
 * When the eyes replace the screen saver, all screens are blurred, not only the ones with eyes.
 */
export function blurOnlyDisplays<T extends DisplayInfo>(all: readonly T[], eyeScreens: readonly T[]): T[] {
  const ids = new Set(eyeScreens.map((d) => d.id));
  return all.filter((d) => !ids.has(d.id));
}

/** Returns the displays that should show the eyes. Never empty when at least one display exists. */
export function selectDisplays<T extends DisplayInfo>(all: readonly T[], primaryId: number, choice: ScreenChoice): T[] {
  if (all.length === 0) return [];
  const primary = all.find((d) => d.id === primaryId) ?? all[0]!;
  switch (choice.mode) {
    case 'builtin': {
      const builtIn = all.filter((d) => d.internal);
      return builtIn.length ? builtIn : [primary];
    }
    case 'all':
      return [...all];
    case 'primary':
      return [primary];
    case 'selected': {
      const chosen = all.filter((d) => choice.ids.includes(d.id));
      return chosen.length ? chosen : [primary];
    }
  }
}
