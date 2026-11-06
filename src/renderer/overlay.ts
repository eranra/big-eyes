import { EyeAnimator } from '../core/animator';
import { averageReference } from '../core/attention';
import type { BigEyesApi } from '../core/ipc';
import { defaultSettings, type GazeReference, type Settings } from '../core/settings';
import { drawEyes, eyeBounds, eyeLayout } from './draw';
import { FaceTracker } from './tracker';

declare global {
  interface Window {
    bigEyes: BigEyesApi;
  }
}

/**
 * The overlay page. One per screen. The window covers the screen, is transparent, and lets clicks pass through.
 * The "tracker" overlay also runs the camera and shares faces with the other overlays through the main process.
 */
const api = window.bigEyes;
const isTracker = api.role?.isTracker ?? true;
const canvas = document.getElementById('eyes') as HTMLCanvasElement;
const backdrop = document.getElementById('backdrop') as HTMLDivElement;
const ctx = canvas.getContext('2d')!;

let settings: Settings = defaultSettings();
let animator = new EyeAnimator(settings, (Math.random() * 2 ** 31) | 0, performance.now() / 1000);
let visible = false;
let frameHandle = 0;
const startTime = performance.now() / 1000;

/** Camera-by-camera calibration: the queue of cameras still to do, the one being recorded, and its samples. */
let calibrationQueue: Array<{ index: number; label: string; id: string }> = [];
let calibrating: { index: number; label: string; id: string; end: number; total: number; position: number } | null = null;
let calibrationSamples: GazeReference[] = [];
let calibrationCenters: Array<{ x: number; y: number }> = [];
let calibrationFailed: string[] = [];
let messageTimer = 0;

// Guided test: instructions shown on screen; each log line names the current step.
const GUIDED_STEPS: ReadonlyArray<{ until: number; text: string; phase: string }> = [
  { until: 3, text: 'Get ready…', phase: 'ready' },
  { until: 11, text: 'Look into my eyes', phase: 'LOOK' },
  { until: 19, text: 'Now smile at me 😊', phase: 'SMILE' },
  { until: 27, text: 'Now look away', phase: 'AWAY' },
  { until: Infinity, text: 'Thank you', phase: 'done' },
];
let guidedStart: number | null = null;
function guidedStep(now: number): (typeof GUIDED_STEPS)[number] | null {
  if (guidedStart === null) return null;
  const t = now - guidedStart;
  return GUIDED_STEPS.find((s) => t < s.until) ?? null;
}

const tracker = isTracker ? new FaceTracker(new URL('./', location.href).toString()) : null;
if (tracker) {
  let lastLog = 0;
  tracker.onFaces = (faces, time, cameras) => {
    const openCameras = tracker.openCameras;
    animator.setCameras(openCameras);
    if (presenceActive && !visible) api.sendPresenceFaces({ faces, cameras, openCameras });
    if (settings.showDebugInfo && time - lastLog > 1) {
      lastLog = time;
      const f = faces[0];
      const step = guidedStep(performance.now() / 1000);
      const perCamera = [0, 1, 2].map((c) => faces.filter((x) => (x.camera ?? 0) === c).length).join('/');
      console.log((step ? `[${step.phase}] ` : '') + `faces=${perCamera} smile=${animator.person.smile.toFixed(2)}${animator.person.isSmiling ? '!' : ''} mood=${animator.mood}` + (f ? ` yaw=${f.yaw.toFixed(1)} pitch=${f.pitch.toFixed(1)} gaze=${f.gaze ? f.gaze.x.toFixed(2) + ',' + f.gaze.y.toFixed(2) : '-'} pos=${animator.person.position.x.toFixed(2)},${animator.person.position.y.toFixed(2)} contact=${animator.person.contactScore.toFixed(2)}` : ''));
    }
    animator.ingest(faces, time, cameras);
    api.sendFaces({ faces, time, cameras, openCameras });
  };
  tracker.onError = (message) => {
    if (presenceActive && !visible) {
      api.sendPresenceFaces({ faces: [], error: message });
      return;
    }
    api.sendStatus(message);
    showMessage("I can't see you", 4000);
  };
}
api.onFaces(({ faces, time, cameras, openCameras }) => {
  if (openCameras) animator.setCameras(openCameras);
  animator.ingest(faces, time, cameras);
});

// Presence check: while the eyes are hidden, the main process can ask for a short camera look
// ("is someone reading the screen?"). Only the tracker window does this.
let presenceActive = false;
api.onPresenceCheck((active) => {
  if (!tracker) return;
  presenceActive = active;
  if (active) void startTracker();
  else if (!visible) tracker.stop();
});

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
}
window.addEventListener('resize', resize);
resize();

function applySettings(next: Settings): void {
  const cameraChanged = JSON.stringify(next.cameras) !== JSON.stringify(settings.cameras);
  settings = next;
  animator.apply(next);
  document.documentElement.style.setProperty('--dim', String(next.backgroundDim));
  document.documentElement.style.setProperty('--blur', String(next.blurStrength));
  if (tracker && visible && cameraChanged) void startTracker();
  void reportCameras();
}

async function startTracker(): Promise<void> {
  if (!tracker) return;
  const t0 = performance.now();
  await tracker.start(settings.cameras);
  const opened = tracker.activeCameraLabels.join(' + ') || 'none';
  api.sendLog(`cameras opened: ${opened} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  if (settings.showDebugInfo) console.log(`cameras opened: ${opened}`);
  await reportCameras();
}

async function reportCameras(): Promise<void> {
  if (!tracker) return;
  try {
    api.sendCameras(await FaceTracker.listCameras());
  } catch {
    // Not important: the menu then shows only "System Default".
  }
}

function setVisible(next: boolean): void {
  if (next === visible) return;
  visible = next;
  document.body.classList.toggle('visible', next);
  if (next) {
    // A fresh animator each time, so the eyes wake up from closed.
    const now = performance.now() / 1000;
    animator = new EyeAnimator(settings, (Math.random() * 2 ** 31) | 0, now);
    animator.wakeUp(now);
    closeRequested = false;
    if (api.role?.guidedTest) guidedStart = now;
    if (tracker) void startTracker();
    cancelAnimationFrame(frameHandle);
    frameHandle = requestAnimationFrame(frame);
  } else {
    tracker?.stop();
    presenceActive = false;
    calibrating = null;
    calibrationQueue = [];
    // Keep drawing during the fade-out, then stop.
    setTimeout(() => {
      if (!visible) cancelAnimationFrame(frameHandle);
    }, 500);
  }
}

function showMessage(text: string | null, durationMs = 0): void {
  window.clearTimeout(messageTimer);
  animator.messageOverride = text;
  if (text && durationMs > 0) messageTimer = window.setTimeout(() => (animator.messageOverride = null), durationMs);
}

/**
 * Calibration, camera by camera. Each open camera gets its own step: "Look into my eyes - camera 1 of 2: <name>".
 * Only that camera's frames are recorded, and the result is saved as that camera's own calibration.
 * @param only calibrate only the camera with this name (from the menu); otherwise all open cameras, one by one.
 */
function startCalibration(only?: string): void {
  if (!tracker) return;
  const open = tracker.openCameras;
  calibrationQueue = only ? open.filter((c) => c.label === only) : [...open];
  calibrationFailed = [];
  if (!calibrationQueue.length) {
    // The cameras are still starting: try again in a moment.
    if (performance.now() - calibrationRequestedAt < 8000) window.setTimeout(() => startCalibration(only), 500);
    else showMessage("I can't see you", 2500);
    return;
  }
  animator.lookToCloseSuspended = true;
  nextCalibrationStep(calibrationQueue.length);
}
let calibrationRequestedAt = 0;

function shortName(label: string): string {
  return label.replace(/\s*\([0-9a-f:]+\)\s*$/i, '');
}

function nextCalibrationStep(total: number): void {
  const cam = calibrationQueue.shift();
  if (!cam) {
    window.setTimeout(() => (animator.lookToCloseSuspended = false), 3000);
    const done = calibrationFailed.length === 0;
    showMessage(done ? (total > 1 ? 'All cameras calibrated' : 'Got it') : `${calibrationFailed.join(', ')}: I couldn't see you`, 2500);
    calibrating = null;
    return;
  }
  calibrationSamples = [];
  calibrationCenters = [];
  const position = total - calibrationQueue.length;
  calibrating = { ...cam, end: performance.now() / 1000 + 3.2, total, position };
  api.sendLog(`calibration: camera ${position} of ${total}: ${cam.label}`);
  showMessage(total > 1 ? `Look into my eyes - camera ${position} of ${total}: ${shortName(cam.label)}` : 'Look into my eyes…');
}

function updateCalibration(now: number): void {
  const step = calibrating;
  if (!step) return;
  // Skip the first second, so the person has time to look. Record ONLY this camera.
  if (step.end - now < 2.2) {
    const estimator = animator.attention.camera(step.index);
    const sample = estimator.calibrationSample();
    const face = estimator.lastObservation;
    if (sample && face) {
      calibrationSamples.push(sample);
      calibrationCenters.push(face.center);
    }
  }
  if (now < step.end) return;
  const reference = averageReference(calibrationSamples);
  if (reference && isTracker) {
    const n = calibrationCenters.length;
    const faceCenter = {
      x: calibrationCenters.reduce((a, c) => a + c.x, 0) / n,
      y: calibrationCenters.reduce((a, c) => a + c.y, 0) / n,
    };
    api.sendCalibrated({ label: step.label, id: step.id, reference, faceCenter, date: new Date().toISOString() });
  } else if (!reference) {
    calibrationFailed.push(shortName(step.label));
    api.sendLog(`calibration: ${step.label}: no face seen, not saved`);
  }
  nextCalibrationStep(step.total);
}

function debugText(): string {
  const p = animator.person;
  const n = (v: number, d = 2): string => v.toFixed(d);
  const lines = [
    `mood: ${animator.mood}   present: ${p.isPresent}   contact: ${p.isMakingEyeContact ? 'YES' : 'no'} ${n(p.contactSeconds, 1)}s   smile+contact: ${n(p.smileContactSeconds, 1)}s`,
    `position: ${n(p.position.x)}, ${n(p.position.y)}   size: ${n(p.size)}   smile: ${n(p.smile)}`,
  ];
  // One line per camera: each one works on its own.
  for (const cam of tracker?.openCameras ?? []) {
    const e = animator.attention.camera(cam.index);
    const s = e.state;
    const f = e.lastObservation;
    const cal = animator.attention.calibrationOf(cam.index) ? 'calibrated' : e.contactAllowed ? 'default' : 'NOT calibrated';
    const angles = f ? `yaw ${n(f.yaw, 0)} pitch ${n(f.pitch, 0)}` : '-';
    lines.push(
      `${shortName(cam.label)} [${cal}]: ${s.isPresent ? 'face' : 'no face'}  contact ${n(s.contactScore)} ${s.isMakingEyeContact ? 'YES' : 'no'} ${n(s.contactSeconds, 1)}s  smile ${n(s.smile)}  ${angles}`,
    );
  }
  lines.push(`role: ${isTracker ? 'tracker' : 'mirror'}`);
  return lines.join('\n');
}

let lastAreaReport = 0;
let closeRequested = false;
/** Tells the main process where the eyes are, so moving the mouse there hides them. 10 times per second. */
function reportEyeArea(pose: ReturnType<EyeAnimator['update']>, now: number): void {
  if (now - lastAreaReport < 0.1) return;
  lastAreaReport = now;
  const box = eyeBounds(eyeLayout(window.innerWidth, window.innerHeight, pose, settings.eyeSize, settings.look, settings.position));
  api.sendEyeArea(box);
}

function frame(): void {
  frameHandle = requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  updateCalibration(now);
  const step = guidedStep(now);
  if (step) animator.messageOverride = step.text;
  const pose = animator.update(now);
  reportEyeArea(pose, now);
  if (animator.wantsToClose && !closeRequested) {
    closeRequested = true;
    api.requestClose();
  }
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawEyes(ctx, window.innerWidth, window.innerHeight, pose, {
    irisColor: settings.irisColor,
    look: settings.look,
    eyeSize: settings.eyeSize,
    position: settings.position,
    time: now - startTime,
    debug: settings.showDebugInfo ? debugText() : null,
  });
}

// The main process turns the blur on when the screen saver time is reached (or at once in "always" mode).
api.onBlur((on) => document.body.classList.toggle('blur', on));
api.onSettings(applySettings);
api.onVisibility(setVisible);
api.onCalibrate((camera) => {
  calibrationRequestedAt = performance.now();
  startCalibration(camera ?? undefined);
});
void api.getSettings().then(applySettings);
void backdrop; // styled by CSS only
