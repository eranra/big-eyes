import { EyeAnimator } from '../core/animator';
import type { AboutInfo, BigEyesApi } from '../core/ipc';
import { defaultSettings } from '../core/settings';
import { ISSUES_URL, RELEASES_URL, REPO_URL } from '../core/update';
import { drawEyes } from './draw';

declare global {
  interface Window {
    bigEyes: BigEyesApi;
  }
}

const api = window.bigEyes;
const $ = (id: string): HTMLElement => document.getElementById(id)!;

// Small live eyes that look around and blink, using the real animator.
const canvas = $('eyes') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const settings = { ...defaultSettings(), showCaptions: false };
const animator = new EyeAnimator(settings, 7, performance.now() / 1000);
animator.wakeUp(performance.now() / 1000);
let pointer: { x: number; y: number } | null = null;
window.addEventListener('mousemove', (e) => (pointer = { x: e.clientX, y: e.clientY }));
window.addEventListener('mouseleave', () => (pointer = null));

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  // The eyes follow the mouse pointer in this window, as if it were a face.
  if (pointer) {
    const x = 0.5 - (pointer.x / window.innerWidth - 0.5) * 0.9;
    const y = 0.5 + (pointer.y / window.innerHeight - 0.35) * 0.6;
    const ref = settings.attention.reference;
    animator.ingest([{ center: { x, y }, size: 0.3, yaw: 30, pitch: ref.pitch, gaze: null, smile: 0, blink: 0, confidence: 1 }], now);
  }
  const pose = animator.update(now);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawEyes(ctx, w, h, { ...pose, mouthOpacity: 0 }, { irisColor: settings.irisColor, look: settings.look, eyeSize: 1.15, time: now });
}
requestAnimationFrame(frame);

function render(info: AboutInfo): void {
  $('version').textContent = `Version ${info.version}`;
  $('details').textContent = `${info.platform} ${info.arch} · Electron ${info.electron} · Chromium ${info.chrome}`;
  const status = $('status');
  status.textContent = info.updateStatus;
  status.classList.toggle('new', /available|ready|Downloading/i.test(info.updateStatus));
  $('license').textContent = `© 2026 ${info.author} and contributors · ${info.license} License · ${info.updateMode}`;
}

$('check').addEventListener('click', () => {
  $('status').textContent = 'Checking…';
  api.checkUpdates();
});
const links: Record<string, string> = { repo: REPO_URL, releases: RELEASES_URL, issues: ISSUES_URL };
document.querySelectorAll<HTMLAnchorElement>('[data-link]').forEach((a) => {
  a.addEventListener('click', () => api.openLink(links[a.dataset.link!]!));
});

api.onAboutUpdate(render);
void api.getAbout().then(render);
