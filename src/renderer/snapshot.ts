import { staticPose } from '../core/animator';
import { MOODS, type Mood } from '../core/mood';
import { defaultSettings, THEMES } from '../core/settings';
import { drawEyes } from './draw';

/** Renders still images of each mood. Used by `npm run snapshots` for the docs and for visual checks. */
declare global {
  interface Window {
    snapshotMoods: readonly Mood[];
    renderMood: (mood: Mood) => void;
    renderStrip: () => void;
  }
}

const canvas = document.getElementById('eyes') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** Mood names, plus "theme-<id>" entries that show each theme looking happy. */
window.snapshotMoods = [...MOODS, ...THEMES.map((t) => `theme-${t.id}` as Mood), 'corner' as Mood, 'goodbye' as Mood];
window.renderMood = (name: Mood): void => {
  const theme = THEMES.find((t) => `theme-${t.id}` === name);
  const special = (name as string) === 'corner' || (name as string) === 'goodbye';
  const mood: Mood = theme ? 'curious' : special ? 'happy' : name;
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const settings = { ...defaultSettings(), showCaptions: true };
  const pose = staticPose(mood, settings);
  if (theme) pose.gaze = { x: -0.25, y: 0.1 };
  if ((name as string) === 'goodbye') {
    // Look-to-close: the ring is almost full and the eyes wink.
    pose.closeProgress = 0.8;
    pose.wink = 0.9;
    pose.captionOpacity = 0;
  }
  if ((name as string) === 'corner') pose.captionOpacity = 0;
  drawEyes(ctx, w, h, pose, {
    position: (name as string) === 'corner' ? 'bottom-right' : 'center',
    irisColor: theme?.irisColor ?? settings.irisColor,
    look: theme?.look ?? settings.look,
    eyeSize: 1,
    time: 1.3,
  });
};

/** All themes side by side, each in a different mood, for the README banner. */
window.renderStrip = (): void => {
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const moods: Mood[] = ['curious', 'happy', 'surprised', 'curious', 'bored'];
  const cell = w / THEMES.length;
  const settings = defaultSettings();
  THEMES.forEach((theme, i) => {
    const pose = staticPose(moods[i % moods.length]!, settings);
    pose.captionOpacity = 0;
    pose.gaze = moods[i] === 'bored' ? pose.gaze : { x: (i - 2) * -0.2, y: 0.05 };
    ctx.setTransform(dpr, 0, 0, dpr, i * cell * dpr, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cell, h);
    ctx.clip();
    // drawEyes clears its area; draw into a cell-sized region.
    drawEyes(ctx, cell, h, pose, { irisColor: theme.irisColor, look: theme.look, eyeSize: 1.45, time: 1.3 });
    ctx.restore();
  });
};
