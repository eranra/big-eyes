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

let calibrationEnd: number | null = null;
let calibrationSamples: GazeReference[] = [];
let messageTimer = 0;

// Guided test: instructions shown on screen; each log line names the current step.
const GUIDED_STEPS: ReadonlyArray<{ until: number; text: string; phase: string }> = [
  { until: 3, text: 'Get ready…', phase: 'ready' },
  { until: 11, text: 'Look into my eyes', phase: 'LOOK' },
  { until: 19, text: 'Now look away', phase: 'AWAY' },
  { until: 27, text: 'Look back at me', phase: 'LOOK' },
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
  tracker.onFaces = (faces, time) => {
    if (settings.showDebugInfo && time - lastLog > 1) {
      lastLog = time;
      const f = faces[0];
      const step = guidedStep(performance.now() / 1000);
      console.log((step ? `[${step.phase}] ` : '') + `faces=${faces.length} mood=${animator.mood}` + (f ? ` yaw=${f.yaw.toFixed(1)} pitch=${f.pitch.toFixed(1)} gaze=${f.gaze ? f.gaze.x.toFixed(2) + ',' + f.gaze.y.toFixed(2) : '-'} pos=${animator.person.position.x.toFixed(2)},${animator.person.position.y.toFixed(2)} contact=${animator.person.contactScore.toFixed(2)}` : ''));
    }
    animator.ingest(faces, time);
    api.sendFaces({ faces, time });
  };
  tracker.onError = (message) => {
    api.sendStatus(message);
    showMessage("I can't see you", 4000);
  };
}
api.onFaces(({ faces, time }) => animator.ingest(faces, time));

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
  const cameraChanged =
    next.cameraId !== settings.cameraId || next.cameraLabel !== settings.cameraLabel || next.cameraKind !== settings.cameraKind;
  settings = next;
  animator.apply(next);
  document.documentElement.style.setProperty('--dim', String(next.backgroundDim));
  if (tracker && visible && cameraChanged) void startTracker();
  void reportCameras();
}

async function startTracker(): Promise<void> {
  if (!tracker) return;
  await tracker.start(settings);
  if (settings.showDebugInfo) console.log(`camera opened: ${tracker.activeCameraLabel ?? 'none'}`);
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
    calibrationEnd = null;
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

function startCalibration(): void {
  animator.lookToCloseSuspended = true;
  calibrationSamples = [];
  calibrationEnd = performance.now() / 1000 + 3.2;
  showMessage('Look into my eyes…');
}

function updateCalibration(now: number): void {
  if (calibrationEnd === null) return;
  // Skip the first second, so the person has time to look.
  if (calibrationEnd - now < 2.2) {
    const sample = animator.attention.calibrationSample();
    if (sample) calibrationSamples.push(sample);
  }
  if (now < calibrationEnd) return;
  calibrationEnd = null;
  // Give the person a moment after calibration before look-to-close can start.
  window.setTimeout(() => (animator.lookToCloseSuspended = false), 3000);
  const reference = averageReference(calibrationSamples);
  if (!reference) {
    showMessage("I can't see you", 2500);
    return;
  }
  if (isTracker) api.sendCalibrated(reference);
  showMessage('Got it', 1500);
}

function debugText(): string {
  const p = animator.person;
  const f = animator.attention.lastObservation;
  const n = (v: number, d = 2): string => v.toFixed(d);
  const lines = [
    `mood: ${animator.mood}   present: ${p.isPresent}   contact: ${n(p.contactScore)} ${p.isMakingEyeContact ? 'YES' : 'no'}`,
    `position: ${n(p.position.x)}, ${n(p.position.y)}   size: ${n(p.size)}   smile: ${n(p.smile)}`,
  ];
  if (f) {
    const gaze = f.gaze ? `${n(f.gaze.x)}, ${n(f.gaze.y)}` : '-';
    lines.push(`yaw: ${n(f.yaw, 1)}   pitch: ${n(f.pitch, 1)}   gaze: ${gaze}`);
  }
  lines.push(`role: ${isTracker ? 'tracker' : 'mirror'}   camera: ${tracker?.activeCameraLabel ?? settings.cameraLabel ?? 'default'}`);
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

api.onSettings(applySettings);
api.onVisibility(setVisible);
api.onCalibrate(startCalibration);
void api.getSettings().then(applySettings);
void backdrop; // styled by CSS only
