import { EyeAnimator } from '../core/animator';
import { chooseCameras, findCamera, isBuiltInCamera } from '../core/camera';
import type { CameraInfo } from '../core/ipc';
import type { BigEyesApi, DisplaySummary } from '../core/ipc';
import type { Mood } from '../core/mood';
import { defaultSettings, EYE_SHAPES, IRIS_PRESETS, MOUSE_RULES, POSITIONS, PUPIL_SHAPES, SCREEN_SAVER_MODES, BLUR_MODES, SCREEN_SAVER_TIME_PRESETS, IRIS_STYLES, matchingTheme, THEMES, type LookSettings, type Settings } from '../core/settings';
import { drawEyes } from './draw';
import { FaceTracker } from './tracker';

declare global {
  interface Window {
    bigEyes: BigEyesApi;
  }
}

const api = window.bigEyes;
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
let settings: Settings = defaultSettings();
let displays: DisplaySummary[] = [];
let previewMood: Mood = 'curious';
let previousCameras: Settings['cameras'] = defaultSettings().cameras;
const defaults = defaultSettings();

if (navigator.userAgent.includes('Macintosh')) document.body.classList.add('mac');

// ---- Live preview: a real animator, driven by a fake person so the eyes show the chosen mood. ----

const canvas = $<HTMLCanvasElement>('preview');
const ctx = canvas.getContext('2d')!;
let animator = new EyeAnimator(settings, 11, performance.now() / 1000);
const start = performance.now() / 1000;
let previewStart = start;

function fakeFaces(mood: Mood, t: number) {
  // A person who moves a little, so you can see the eyes follow.
  const x = 0.5 + Math.sin(t * 0.6) * 0.18;
  const y = 0.5 + Math.sin(t * 0.37) * 0.08;
  const ref = settings.attention.reference;
  const looking = { yaw: ref.yaw, pitch: ref.pitch, gaze: ref.gaze };
  switch (mood) {
    case 'sleeping':
      return [];
    case 'surprised':
      // Nobody at first, then a person appears. The eyes wake up surprised. Repeats every 4 s.
      return (performance.now() / 1000 - previewStart) % 4 < 1.2
        ? []
        : [{ center: { x, y }, size: 0.3, yaw: 30, pitch: 0, gaze: null, smile: 0, blink: 0, confidence: 1 }];
    case 'happy':
      return [{ center: { x, y }, size: 0.3, ...looking, smile: 0.1, blink: 0, confidence: 1 }];
    case 'delighted':
      // Looking at the eyes and smiling, a bit more and a bit less over time.
      return [{ center: { x, y }, size: 0.3, ...looking, smile: 0.75 + Math.sin(t * 1.3) * 0.2, blink: 0, confidence: 1 }];
    case 'bored':
      return [{ center: { x, y }, size: 0.3, yaw: 40, pitch: 0, gaze: { x: 0.8, y: 0 }, smile: 0, blink: 0, confidence: 1 }];
    default:
      return [{ center: { x, y }, size: 0.3, yaw: 30, pitch: 0, gaze: null, smile: 0, blink: 0, confidence: 1 }];
  }
}

function resetPreview(): void {
  const now = performance.now() / 1000;
  // Short dwell times so the preview reaches the chosen mood quickly.
  const quick: Settings = {
    ...settings,
    mood: { ...settings.mood, smileBack: true, contactToHappy: 0.2, happyHold: 0.4, awayToBored: 0.6, surpriseDuration: 99, absentToSleep: 0.5, smileToDelighted: 0.2 },
  };
  if (previewMood === 'curious') {
    // Curious: the person looks around but the eyes never get bored.
    quick.mood = { ...quick.mood, awayToBored: 1e9 };
  }
  if (previewMood === 'surprised') {
    quick.mood = { ...quick.mood, surpriseDuration: 1.5, absentToSleep: 0.3 };
    quick.attention = { ...quick.attention, absenceGrace: 0.2 };
  }
  previewStart = now;
  animator = new EyeAnimator(quick, 11, now);
  animator.wakeUp(now);
}

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  animator.ingest(fakeFaces(previewMood, now - start), now);
  const pose = animator.update(now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The preview is small: scale the eyes like on a screen, limited by the preview height.
  drawEyes(ctx, w, h, pose, { irisColor: settings.irisColor, look: settings.look, eyeSize: Math.min(settings.eyeSize, 1.25), time: now - start });
}
requestAnimationFrame(frame);

document.querySelectorAll<HTMLButtonElement>('.mood-buttons button').forEach((button) => {
  button.addEventListener('click', () => {
    previewMood = button.dataset.mood as Mood;
    document.querySelectorAll('.mood-buttons button').forEach((b) => b.classList.toggle('on', b === button));
    resetPreview();
  });
});

// ---- Form binding ----

const formatSeconds = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)}m${s % 60 ? ` ${s % 60}s` : ''}` : `${s}s`);

type NumberField = 'eyeSize' | 'backgroundDim' | 'idleTimeout';
const numberFields: Record<NumberField, (v: number) => string> = {
  eyeSize: (v) => `${Math.round(v * 100)}%`,
  backgroundDim: (v) => (v === 0 ? 'none' : `${Math.round(v * 100)}%`),
  idleTimeout: formatSeconds,
};
type BoolField = 'showCaptions' | 'respectVideoPlayback' | 'openAtLogin' | 'paused' | 'mirrorCamera' | 'showDebugInfo' | 'waitWhileWatched';
const boolFields: BoolField[] = ['showCaptions', 'respectVideoPlayback', 'openAtLogin', 'paused', 'mirrorCamera', 'showDebugInfo', 'waitWhileWatched'];

let saveTimer = 0;
function save(patch: Record<string, unknown>, delay = 150): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void api.updateSettings(patch).then(render);
  }, delay);
}

for (const [key, format] of Object.entries(numberFields) as Array<[NumberField, (v: number) => string]>) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    (input.nextElementSibling as HTMLOutputElement).value = format(value);
    settings = { ...settings, [key]: value };
    save({ [key]: value });
  });
}
for (const key of boolFields) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('change', () => save({ [key]: input.checked }, 0));
}
for (const key of ['welcomeText', 'boredText'] as const) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    settings = { ...settings, [key]: input.value };
    save({ [key]: input.value }, 400);
  });
}

const irisInput = $<HTMLInputElement>('irisColor');
irisInput.addEventListener('input', () => {
  settings = { ...settings, irisColor: irisInput.value };
  save({ irisColor: irisInput.value });
});
const swatches = $('irisPresets');
for (const preset of IRIS_PRESETS) {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.title = preset.label;
  b.style.background = preset.value;
  b.dataset.value = preset.value;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    save({ irisColor: preset.value }, 0);
  });
  swatches.append(b);
}

// ---- Look ----

const themes = $('themes');
for (const theme of THEMES) {
  const b = document.createElement('button');
  b.textContent = theme.label;
  b.dataset.theme = theme.id;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    save({ irisColor: theme.irisColor, look: theme.look }, 0);
  });
  themes.append(b);
}

const fillSelect = (id: string, options: ReadonlyArray<{ label: string; value: string }>): void => {
  const select = $<HTMLSelectElement>(id);
  for (const o of options) select.append(new Option(o.label, o.value));
  select.addEventListener('change', () => save({ look: { [id]: select.value } }, 0));
};
fillSelect('irisStyle', IRIS_STYLES);
fillSelect('eyeShape', EYE_SHAPES);
fillSelect('pupilShape', PUPIL_SHAPES);

type LookNumber = 'irisSize' | 'pupilSize' | 'spacing' | 'glowStrength';
const lookNumbers: LookNumber[] = ['irisSize', 'pupilSize', 'spacing', 'glowStrength'];
const percent = (v: number): string => `${Math.round(v * 100)}%`;
for (const key of lookNumbers) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    (input.nextElementSibling as HTMLOutputElement).value = percent(value);
    settings = { ...settings, look: { ...settings.look, [key]: value } };
    save({ look: { [key]: value } });
  });
}
type LookColor = 'scleraColor' | 'lidColor' | 'browColor' | 'lashColor' | 'glowColor' | 'mouthColor';
const lookColors: LookColor[] = ['scleraColor', 'lidColor', 'browColor', 'lashColor', 'glowColor', 'mouthColor'];
for (const key of lookColors) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    settings = { ...settings, look: { ...settings.look, [key]: input.value } };
    save({ look: { [key]: input.value } });
  });
}
type LookBool = 'showBrows' | 'showLashes' | 'showBlush' | 'showMouth';
const lookBools: LookBool[] = ['showBrows', 'showLashes', 'showBlush', 'showMouth'];
for (const key of lookBools) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('change', () => save({ look: { [key]: input.checked } }, 0));
}

function renderLook(look: LookSettings): void {
  for (const key of lookNumbers) {
    const input = $<HTMLInputElement>(key);
    if (document.activeElement !== input) input.value = String(look[key]);
    (input.nextElementSibling as HTMLOutputElement).value = percent(look[key]);
  }
  for (const key of lookColors) {
    const input = $<HTMLInputElement>(key);
    if (document.activeElement !== input) input.value = look[key];
  }
  for (const key of lookBools) $<HTMLInputElement>(key).checked = look[key];
  $<HTMLSelectElement>('irisStyle').value = look.irisStyle;
  $<HTMLSelectElement>('eyeShape').value = look.eyeShape;
  $<HTMLSelectElement>('pupilShape').value = look.pupilShape;
  const theme = matchingTheme(settings);
  themes.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.theme === theme));
}

// ---- Position, blinking, closing ----

// A small 3x3 screen map. Corners and the middle are the choices.
const positionGrid = $('positions');
const positionCells: Array<{ value: (typeof POSITIONS)[number]['value']; row: number; col: number }> = [
  { value: 'top-left', row: 1, col: 1 },
  { value: 'top-right', row: 1, col: 3 },
  { value: 'center', row: 2, col: 2 },
  { value: 'bottom-left', row: 3, col: 1 },
  { value: 'bottom-right', row: 3, col: 3 },
];
for (const cell of positionCells) {
  const b = document.createElement('button');
  b.dataset.position = cell.value;
  b.title = POSITIONS.find((p) => p.value === cell.value)?.label ?? cell.value;
  b.setAttribute('aria-label', b.title);
  b.style.gridRow = String(cell.row);
  b.style.gridColumn = String(cell.col);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    save({ position: cell.value }, 0);
  });
  positionGrid.append(b);
}
const positionLabel = document.createElement('span');
positionLabel.className = 'position-label';
positionGrid.after(positionLabel);

const blinkRate = $<HTMLInputElement>('blinkRate');
const blinkSpeed = $<HTMLInputElement>('blinkSpeed');
const rateText = (v: number): string => (v === 0 ? 'never' : v < 0.7 ? 'rarely' : v <= 1.3 ? 'normal' : v <= 2.2 ? 'often' : 'very often');
const speedText = (v: number): string => (v < 0.7 ? 'slow' : v <= 1.3 ? 'normal' : 'quick');
blinkRate.addEventListener('input', () => {
  const v = Number(blinkRate.value);
  (blinkRate.nextElementSibling as HTMLOutputElement).value = rateText(v);
  settings = { ...settings, blink: { ...settings.blink, rate: v } };
  animator.apply({ ...settings, mood: animator.settings.mood });
  save({ blink: { rate: v } });
});
blinkSpeed.addEventListener('input', () => {
  const v = Number(blinkSpeed.value);
  (blinkSpeed.nextElementSibling as HTMLOutputElement).value = speedText(v);
  settings = { ...settings, blink: { ...settings.blink, speed: v } };
  animator.apply({ ...settings, mood: animator.settings.mood });
  save({ blink: { speed: v } });
});

const mouseRules = $('mouseRules');
for (const rule of MOUSE_RULES) {
  const row = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'mouse-rule';
  input.value = rule.value;
  input.addEventListener('change', () => save({ mouseRule: rule.value }, 0));
  const text = document.createElement('span');
  text.textContent = rule.label;
  row.append(input, text);
  mouseRules.append(row);
}
const screenSaverSelect = $<HTMLSelectElement>('screenSaver');
for (const m of SCREEN_SAVER_MODES) screenSaverSelect.append(new Option(m.label, m.value));
screenSaverSelect.addEventListener('change', () => save({ screenSaver: screenSaverSelect.value }, 0));
const saverMinutes = $<HTMLSelectElement>('screenSaverMinutes');
for (const p of SCREEN_SAVER_TIME_PRESETS) saverMinutes.append(new Option(p.label, String(p.value)));
saverMinutes.addEventListener('change', () => save({ screenSaverMinutes: Number(saverMinutes.value) }, 0));
/** Shows the system's time in the "Same as the System" choice, for example "Same as the System (10 min, IT policy)". */
function showSaverTime(time: { seconds: number; source: string } | null): void {
  const option = [...saverMinutes.options].find((o) => o.value === '0');
  if (!option) return;
  const source = time?.source === 'managed policy' ? 'IT policy' : time?.source;
  option.textContent = time ? `Same as the System (${Math.round(time.seconds / 60)} min, ${source})` : 'Same as the System (not set: 10 min)';
}
api.onSaverTime(showSaverTime);
void api.getSaverTime().then(showSaverTime);
const blurSelect = $<HTMLSelectElement>('blur');
for (const m of BLUR_MODES) blurSelect.append(new Option(m.label, m.value));
blurSelect.addEventListener('change', () => save({ blur: blurSelect.value }, 0));
const blurStrength = $<HTMLInputElement>('blurStrength');
blurStrength.addEventListener('input', () => {
  (blurStrength.nextElementSibling as HTMLOutputElement).value = `${Math.round(Number(blurStrength.value) * 100)}%`;
  save({ blurStrength: Number(blurStrength.value) });
});
const smileBack = $<HTMLInputElement>('smileBack');
smileBack.addEventListener('change', () => save({ mood: { smileBack: smileBack.checked } }, 0));
const lookToClose = $<HTMLInputElement>('lookToClose');
lookToClose.addEventListener('change', () => save({ lookToClose: lookToClose.checked }, 0));
const lookSeconds = $<HTMLInputElement>('lookToCloseSeconds');
lookSeconds.addEventListener('input', () => {
  (lookSeconds.nextElementSibling as HTMLOutputElement).value = `${lookSeconds.value}s`;
  save({ lookToCloseSeconds: Number(lookSeconds.value) });
});

function renderBehavior(next: Settings): void {
  positionGrid.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.position === next.position));
  positionLabel.textContent = POSITIONS.find((p) => p.value === next.position)?.label ?? '';
  if (document.activeElement !== blinkRate) blinkRate.value = String(next.blink.rate);
  if (document.activeElement !== blinkSpeed) blinkSpeed.value = String(next.blink.speed);
  (blinkRate.nextElementSibling as HTMLOutputElement).value = rateText(next.blink.rate);
  (blinkSpeed.nextElementSibling as HTMLOutputElement).value = speedText(next.blink.speed);
  mouseRules.querySelectorAll<HTMLInputElement>('input').forEach((i) => (i.checked = i.value === next.mouseRule));
  lookToClose.checked = next.lookToClose;
  smileBack.checked = next.mood.smileBack;
  screenSaverSelect.value = next.screenSaver;
  blurSelect.value = next.blur;
  if (![...saverMinutes.options].some((o) => o.value === String(next.screenSaverMinutes))) {
    saverMinutes.append(new Option(`${next.screenSaverMinutes} minutes`, String(next.screenSaverMinutes)));
  }
  saverMinutes.value = String(next.screenSaverMinutes);
  saverMinutes.disabled = next.screenSaver !== 'replace';
  if (document.activeElement !== blurStrength) blurStrength.value = String(next.blurStrength);
  (blurStrength.nextElementSibling as HTMLOutputElement).value = `${Math.round(next.blurStrength * 100)}%`;
  blurStrength.disabled = next.blur === 'off';
  if (document.activeElement !== lookSeconds) lookSeconds.value = String(next.lookToCloseSeconds);
  (lookSeconds.nextElementSibling as HTMLOutputElement).value = `${next.lookToCloseSeconds}s`;
  lookSeconds.disabled = !next.lookToClose;
}

// Strictness scales all three tolerances together. 1 = default, higher = stricter.
const strictness = $<HTMLInputElement>('strictness');
strictness.addEventListener('input', () => {
  const k = Number(strictness.value);
  (strictness.nextElementSibling as HTMLOutputElement).value = `${k.toFixed(2)}×`;
  const a = defaults.attention;
  save({
    attention: { yawTolerance: a.yawTolerance / k, pitchTolerance: a.pitchTolerance / k, gazeTolerance: a.gazeTolerance / k },
  });
});
for (const key of ['awayToBored', 'absentToSleep'] as const) {
  const input = $<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    (input.nextElementSibling as HTMLOutputElement).value = `${input.value}s`;
    save({ mood: { [key]: Number(input.value) } });
  });
}

// ---- Cameras ----

let knownCameras: CameraInfo[] = [];
async function loadCameras(askPermission = false): Promise<void> {
  if (askPermission) {
    // Names are only visible after a camera was opened once.
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      setStatus('Camera access was denied.');
    }
  }
  knownCameras = await FaceTracker.listCameras();
  api.sendCameras(knownCameras);
  renderCameras();
}

function renderCameras(): void {
  const container = $('cameras');
  container.replaceChildren();
  const choice = settings.cameras;
  const selected = choice.mode === 'selected' ? choice.cameras : [];
  const row = (type: 'radio' | 'checkbox', label: string, checked: boolean, onChange: (on: boolean) => void, disabled = false, badge = '') => {
    const el = document.createElement('label');
    const input = document.createElement('input');
    input.type = type;
    input.name = 'camera-mode';
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = label;
    el.append(input, text);
    if (badge) {
      const b = document.createElement('span');
      b.className = 'main-badge';
      b.textContent = badge;
      el.append(b);
    }
    container.append(el);
  };
  row('radio', 'Built-in camera', choice.mode === 'builtin', () => save({ cameras: { mode: 'builtin' } }, 0));
  row('radio', 'System default', choice.mode === 'default', () => save({ cameras: { mode: 'default' } }, 0));
  row('radio', `All cameras${knownCameras.length ? ` (${knownCameras.length})` : ''}`, choice.mode === 'all', () =>
    save({ cameras: { mode: 'all' } }, 0),
  );
  for (const cam of knownCameras) {
    const index = selected.findIndex((c) => findCamera([cam], c) !== null);
    const on = index >= 0;
    row(
      'checkbox',
      `${cam.label}${isBuiltInCamera(cam.label) ? ' (built-in)' : ''}`,
      on,
      (checked) => {
        const next = checked ? [...selected, { id: cam.deviceId, label: cam.label }] : selected.filter((_, i) => i !== index);
        save({ cameras: next.length ? { mode: 'selected', cameras: next } : { mode: 'builtin' } }, 0);
      },
      false,
      on && index === 0 && selected.length > 1 ? 'main' : '',
    );
  }
  for (const saved of selected) {
    if (!knownCameras.some((c) => findCamera([c], saved))) row('checkbox', `${saved.label || 'Saved camera'} (not connected)`, true, () => {}, true);
  }
}
$('refreshCameras').addEventListener('click', () => void loadCameras(true));

let testStreams: MediaStream[] = [];
const testBox = $('cameraTests');
async function startCameraTest(): Promise<void> {
  stopCameraTest();
  try {
    const ids = chooseCameras(await FaceTracker.listCameras(), settings.cameras);
    for (const id of ids.length ? ids : [null]) {
      const stream = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : true, audio: false });
      testStreams.push(stream);
      const figure = document.createElement('figure');
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      const caption = document.createElement('figcaption');
      caption.textContent = `${testStreams.length === 1 && ids.length > 1 ? 'Main: ' : ''}${stream.getVideoTracks()[0]?.label ?? 'Camera'}`;
      figure.append(video, caption);
      testBox.append(figure);
      await video.play();
    }
    testBox.hidden = false;
    $('testCamera').textContent = 'Stop test';
    await loadCameras();
  } catch {
    setStatus('Could not open a camera.');
    stopCameraTest();
  }
}
function stopCameraTest(): void {
  testStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  testStreams = [];
  testBox.replaceChildren();
  testBox.hidden = true;
  $('testCamera').textContent = 'Test cameras';
}
$('testCamera').addEventListener('click', () => (testStreams.length ? stopCameraTest() : void startCameraTest()));
window.addEventListener('blur', stopCameraTest);

$('calibrate').addEventListener('click', () => {
  stopCameraTest();
  setStatus('Look straight into the eyes for 3 seconds…');
  api.calibrate();
});

// ---- Screens ----

function renderScreens(): void {
  const container = $('screens');
  container.replaceChildren();
  const choice = settings.screens;
  const add = (label: string, checked: boolean, type: 'radio' | 'checkbox', onChange: (checked: boolean) => void, disabled = false) => {
    const row = document.createElement('label');
    row.className = 'screen';
    const input = document.createElement('input');
    input.type = type;
    input.name = 'screen-mode';
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    container.append(row);
  };
  const hasBuiltIn = displays.some((d) => d.internal);
  add(hasBuiltIn ? 'Built-in screen' : 'Built-in screen (none found, using the main screen)', choice.mode === 'builtin', 'radio', () =>
    save({ screens: { mode: 'builtin' } }, 0),
  );
  add('All screens', choice.mode === 'all', 'radio', () => save({ screens: { mode: 'all' } }, 0));
  add('Main screen only', choice.mode === 'primary', 'radio', () => save({ screens: { mode: 'primary' } }, 0));
  if (displays.length > 1) {
    const selected = choice.mode === 'selected' ? choice.ids : [];
    for (const d of displays) {
      const on = selected.includes(d.id);
      add(
        `${d.label}${d.internal ? ' (built-in)' : d.primary ? ' (main)' : ''} — ${d.width}×${d.height}`,
        on,
        'checkbox',
        (checked) => {
          const ids = checked ? [...selected, d.id] : selected.filter((id) => id !== d.id);
          save({ screens: ids.length ? { mode: 'selected', ids } : { mode: 'primary' } }, 0);
        },
      );
    }
  }
}

// ---- Render ----

function render(next: Settings): void {
  const moodChanged = JSON.stringify(next.mood) !== JSON.stringify(settings.mood);
  settings = next;
  animator.apply({ ...next, mood: animator.settings.mood });
  if (moodChanged) resetPreview();
  for (const [key, format] of Object.entries(numberFields) as Array<[NumberField, (v: number) => string]>) {
    const input = $<HTMLInputElement>(key);
    if (document.activeElement !== input) input.value = String(next[key]);
    (input.nextElementSibling as HTMLOutputElement).value = format(next[key]);
  }
  for (const key of boolFields) $<HTMLInputElement>(key).checked = next[key];
  for (const key of ['welcomeText', 'boredText'] as const) {
    const input = $<HTMLInputElement>(key);
    if (document.activeElement !== input) input.value = next[key];
  }
  irisInput.value = next.irisColor;
  renderLook(next.look);
  renderBehavior(next);
  swatches.querySelectorAll<HTMLButtonElement>('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.value === next.irisColor));
  const k = defaults.attention.yawTolerance / next.attention.yawTolerance;
  if (document.activeElement !== strictness) strictness.value = String(k);
  (strictness.nextElementSibling as HTMLOutputElement).value = `${k.toFixed(2)}×`;
  for (const key of ['awayToBored', 'absentToSleep'] as const) {
    const input = $<HTMLInputElement>(key);
    if (document.activeElement !== input) input.value = String(next.mood[key]);
    (input.nextElementSibling as HTMLOutputElement).value = `${next.mood[key]}s`;
  }
  const camerasChanged = JSON.stringify(next.cameras) !== JSON.stringify(previousCameras);
  previousCameras = next.cameras;
  renderCameras();
  if (camerasChanged && testStreams.length) void startCameraTest();
  renderScreens();
}

function setStatus(message: string): void {
  $('status').textContent = message;
}

$('previewNow').addEventListener('click', () => api.preview());
$('reset').addEventListener('click', () => {
  if (confirm('Reset all settings to the defaults? This also removes your eye contact calibration.')) {
    void api.resetSettings().then(render);
  }
});

api.onSettings(render);
api.onStatus(setStatus);

void (async () => {
  displays = await api.getDisplays();
  render(await api.getSettings());
  resetPreview();
  await loadCameras();
})();
