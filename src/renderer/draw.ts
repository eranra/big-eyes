import type { EyePose } from '../core/animator';
import { clampLength, lerp, smoothstep } from '../core/math';
import { THEMES, type EyePosition, type LookSettings } from '../core/settings';

const DEFAULT_LOOK: LookSettings = THEMES[0]!.look;

/**
 * Draws the eye pair for one pose on a 2D canvas. Pure drawing, no state.
 *
 * Coordinates: the canvas uses y down. Inside an eye we use "eye units": u (-1 left .. 1 right)
 * and v (-1 bottom .. 1 top), converted with `point()`.
 *
 * Drawing order per eye:
 * 1. a soft socket (lid skin);
 * 2. the eye opening, clipped between the upper and lower lid curves: sclera, iris, pupil,
 *    highlights, and the shadow of the upper lid;
 * 3. lash line, lower lid line, and three lashes at the outer corner;
 * 4. the eyebrow.
 */
export interface DrawOptions {
  irisColor: string;
  /** Colors and shape. Defaults to the classic look. */
  look?: LookSettings;
  /** Eye size multiplier from settings. */
  eyeSize: number;
  /** Where on the screen the eyes sit. Default center. */
  position?: EyePosition;
  /** Seconds since start, for the sleep "z" animation. */
  time: number;
  /** Debug text drawn in the corner, or null. */
  debug?: string | null;
}

export interface EyeLayout {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  spacing: number;
}

/** Width and height factors of each eye shape. */
const SHAPES: Record<LookSettings['eyeShape'], { w: number; h: number }> = {
  round: { w: 1, h: 1.14 },
  tall: { w: 0.86, h: 1.4 },
  wide: { w: 1.18, h: 0.9 },
};

export function eyeLayout(
  width: number,
  height: number,
  pose: EyePose,
  eyeSize: number,
  look: LookSettings = DEFAULT_LOOK,
  position: EyePosition = 'center',
): EyeLayout {
  const shape = SHAPES[look.eyeShape];
  // In a corner the eyes are smaller, so they do not cover the middle of the screen.
  const cornerScale = position === 'center' ? 1 : 0.6;
  let base = Math.min(width * 0.12, height * 0.19) * eyeSize * cornerScale;
  // Never larger than the screen: the whole group (about 3.9 x base wide plus spacing, 4 x base tall) must fit.
  const spacingFactor = 1.32 * Math.max(look.spacing, (shape.w * 1.1) / 1.32 + 0.02);
  const maxBase = Math.min((width * 0.92) / (2 * (spacingFactor + shape.w * 1.2)), (height * 0.92) / (shape.h * 4.0 * 1.1));
  base = Math.min(base, maxBase);
  const rx = base * pose.scale * shape.w;
  const ry = base * pose.scale * shape.h * (1 - pose.squash);
  const spacing = base * spacingFactor;
  // Half the size of the whole group: eyes, brows above, caption below.
  const halfW = spacing + base * shape.w * 1.2;
  const halfUp = base * shape.h * 1.9;
  const halfDown = base * shape.h * 2.1;
  const margin = Math.min(width, height) * 0.04;
  let cx = width / 2;
  let cy = height / 2 - height * 0.03;
  if (position.endsWith('left')) cx = margin + halfW;
  if (position.endsWith('right')) cx = width - margin - halfW;
  if (position.startsWith('top')) cy = margin + halfUp;
  if (position.startsWith('bottom')) cy = height - margin - halfDown;
  // Keep the group on screen whatever the drift. In a corner the drift is smaller.
  const freeX = Math.max(0, Math.min(cx - halfW, width - cx - halfW));
  const freeY = Math.max(0, Math.min(cy - halfUp, height - cy - halfDown));
  const driftScale = position === 'center' ? 0.9 : 0.5;
  const driftX = position === 'center' ? Math.max(0, width / 2 - spacing - rx * 1.2) : Math.max(freeX, base * 0.4);
  const driftY = position === 'center' ? Math.max(0, height / 2 - ry * 2.2) : Math.max(freeY, base * 0.3);
  return {
    cx: clampNumber(cx + pose.drift.x * driftX * driftScale, halfW * 0.9, width - halfW * 0.9),
    cy: clampNumber(cy - pose.drift.y * driftY * driftScale, halfUp * 0.9, height - halfDown * 0.9),
    rx,
    ry,
    spacing,
  };
}

const clampNumber = (v: number, low: number, high: number): number => (low > high ? (low + high) / 2 : Math.min(Math.max(v, low), high));

/** The box around both eyes and brows, in canvas (CSS pixel) coordinates. */
export function eyeBounds(l: EyeLayout): { x: number; y: number; width: number; height: number } {
  const left = l.cx - l.spacing - l.rx * 1.1;
  const right = l.cx + l.spacing + l.rx * 1.1;
  const top = l.cy - l.ry * 1.75; // includes the brows
  const bottom = l.cy + l.ry * 1.15;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Parses "#rrggbb" into [r, g, b] 0..255. */
export function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [61, 133, 220];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** Mixes a color with white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number, alpha = 1): string {
  const [r, g, b] = parseHex(hex);
  const target = amount >= 0 ? 255 : 0;
  const t = Math.abs(amount);
  const mix = (c: number): number => Math.round(lerp(c, target, t));
  return `rgba(${mix(r)}, ${mix(g)}, ${mix(b)}, ${alpha})`;
}


export function drawEyes(ctx: CanvasRenderingContext2D, width: number, height: number, pose: EyePose, o: DrawOptions): void {
  const look = o.look ?? DEFAULT_LOOK;
  ctx.clearRect(0, 0, width, height);
  const l = eyeLayout(width, height, pose, o.eyeSize, look, o.position);
  if (look.glowStrength > 0) drawGlow(ctx, l, look.glowColor, look.glowStrength);
  if (pose.closeProgress > 0.01) drawCloseRing(ctx, l, pose.closeProgress, look.glowColor);
  for (const side of [-1, 1] as const) {
    const cx = l.cx + side * l.spacing;
    // The wink closes the eye on the screen's right side.
    const eyePose = side === 1 && pose.wink > 0 ? { ...pose, upperLid: pose.upperLid + (1 - pose.upperLid) * pose.wink } : pose;
    drawEye(ctx, cx, l.cy, l.rx, l.ry, side, eyePose, o.irisColor, look);
    if (look.showBrows) drawBrow(ctx, cx, l.cy, l.rx, l.ry, side, pose, look.browColor);
  }
  drawCaption(ctx, l, pose, look.glowColor);
  if (pose.sleepOpacity > 0.01) drawSleep(ctx, l, pose, o.time);
  if (o.debug) drawDebug(ctx, o.debug, height);
}

/** A soft ring around the eyes that fills up while you hold eye contact (look-to-close). */
function drawCloseRing(ctx: CanvasRenderingContext2D, l: EyeLayout, progress: number, color: string): void {
  const rx = l.spacing + l.rx * 1.75;
  const ry = l.ry * 2.15;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(4, l.rx * 0.06);
  ctx.strokeStyle = shade(color, 0.3, 0.18 * Math.min(1, progress * 4));
  ctx.beginPath();
  ctx.ellipse(l.cx, l.cy - l.ry * 0.15, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = shade(color, 0.45, 0.85);
  ctx.shadowColor = shade(color, 0.2, 0.8);
  ctx.shadowBlur = l.rx * 0.2;
  ctx.beginPath();
  ctx.ellipse(l.cx, l.cy - l.ry * 0.15, rx, ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
  ctx.restore();
}

function drawGlow(ctx: CanvasRenderingContext2D, l: EyeLayout, color: string, strength: number): void {
  const radius = l.spacing * 3.2;
  const g = ctx.createRadialGradient(l.cx, l.cy, 0, l.cx, l.cy, radius);
  g.addColorStop(0, shade(color, 0, 0.32 * strength));
  g.addColorStop(1, shade(color, 0, 0));
  ctx.fillStyle = g;
  ctx.fillRect(l.cx - radius, l.cy - radius, radius * 2, radius * 2);
}

/** Upper lid height at u, in eye units. */
function upperLid(u: number, side: number, lower: number, pose: EyePose): number {
  // Lids at 0.9 or more are fully shut, so a sleeping eye shows no white line.
  const lid = Math.min(1, pose.upperLid / 0.9);
  const open = 1.12 + 0.05 * (1 - u * u);
  // Closed: the lids meet slightly below the middle in a soft downward curve (a sleeping eye).
  const closed = Math.max(lower, -0.12 - 0.18 * (1 - u * u));
  const outer = u * side; // 1 at the outer corner, -1 at the inner corner
  return lerp(open, closed, lid) - pose.lidTilt * outer * (1 - lid) * 1.3;
}

/** Lower lid height at u. Rises into an arch when smiling (the happy "^ ^" eyes). */
function lowerLid(u: number, pose: EyePose): number {
  return -1.1 + pose.smile * (0.42 + 0.78 * (1 - u * u));
}

function drawEye(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  side: number,
  pose: EyePose,
  iris: string,
  look: LookSettings,
): void {
  const px = (u: number): number => cx + u * rx;
  const py = (v: number): number => cy - v * ry;

  const steps = 48;
  const us: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  const closing = smoothstep(0.55, 0.9, pose.upperLid);
  for (let i = 0; i <= steps; i++) {
    const u = -1.15 + (2.3 * i) / steps;
    const lo = lowerLid(u, pose);
    const up = upperLid(u, side, lo, pose);
    us.push(u);
    upper.push(up);
    // When the eye is almost closed, the lower lid also rises to meet the upper lid.
    lower.push(lerp(lo, Math.max(lo, Math.min(up, -0.12)), closing));
  }
  const curve = (values: number[], move = true): void => {
    for (let i = 0; i <= steps; i++) {
      if (i === 0 && move) ctx.moveTo(px(us[i]!), py(values[i]!));
      else ctx.lineTo(px(us[i]!), py(values[i]!));
    }
  };
  const ellipse = (grow: number): void => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * (1 + grow), ry * (1 + grow), 0, 0, Math.PI * 2);
  };

  // Everything below the lower lid is cut away. When smiling this turns the eye into a happy crescent.
  const belowLowerLid = (): void => {
    ctx.beginPath();
    curve(lower);
    ctx.lineTo(px(1.3), py(2));
    ctx.lineTo(px(-1.3), py(2));
    ctx.closePath();
    ctx.clip();
  };

  // 1. Socket.
  ctx.save();
  belowLowerLid();
  ellipse(0.06);
  const skin = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
  skin.addColorStop(0, shade(look.lidColor, 0));
  skin.addColorStop(1, shade(look.lidColor, -0.45));
  ctx.fillStyle = skin;
  ctx.fill();
  ctx.restore();

  // 2. Opening.
  ctx.save();
  ellipse(0);
  ctx.clip();
  ctx.beginPath();
  curve(upper);
  for (let i = steps; i >= 0; i--) ctx.lineTo(px(us[i]!), py(lower[i]!));
  ctx.closePath();
  ctx.clip();

  // Sclera: white, cooler and darker at the edges so the ball looks round.
  const sclera = ctx.createRadialGradient(cx - rx * 0.15, cy - ry * 0.2, 0, cx, cy, Math.max(rx, ry) * 1.05);
  sclera.addColorStop(0, shade(look.scleraColor, 0));
  sclera.addColorStop(0.65, shade(look.scleraColor, -0.06));
  sclera.addColorStop(1, shade(look.scleraColor, -0.25));
  ctx.fillStyle = sclera;
  ctx.fillRect(cx - rx * 1.2, cy - ry * 1.2, rx * 2.4, ry * 2.4);

  drawIris(ctx, cx, cy, rx, ry, side, pose, iris, look);

  // Shadow of the upper lid on the eyeball.
  ctx.beginPath();
  curve(upper);
  ctx.lineTo(px(1.2), py(2));
  ctx.lineTo(px(-1.2), py(2));
  ctx.closePath();
  ctx.shadowColor = 'rgba(26, 13, 51, 0.45)';
  ctx.shadowBlur = ry * 0.22;
  ctx.shadowOffsetY = ry * 0.05;
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  // Cheeks: a soft blush under the outer half of the eye when smiling.
  if (look.showBlush && pose.smile > 0.05) {
    const bx = px(0.35 * side);
    const by = py(-1.05);
    const blush = ctx.createRadialGradient(bx, by, 0, bx, by, rx * 0.55);
    blush.addColorStop(0, `rgba(255, 120, 150, ${0.42 * pose.smile})`);
    blush.addColorStop(1, 'rgba(255, 120, 150, 0)');
    ctx.fillStyle = blush;
    ctx.beginPath();
    ctx.ellipse(bx, by, rx * 0.55, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Lash line and lower lid line, clipped to the socket so they fade at the corners.
  ctx.save();
  belowLowerLid();
  ellipse(0.06);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  curve(upper);
  ctx.strokeStyle = look.lashColor;
  ctx.lineWidth = rx * 0.075;
  ctx.stroke();
  ctx.beginPath();
  curve(lower);
  ctx.strokeStyle = shade(look.lashColor, 0.1, 0.55 + 0.4 * pose.smile);
  ctx.lineWidth = rx * (0.035 + 0.04 * pose.smile);
  ctx.stroke();
  ctx.restore();

  if (!look.showLashes) return;
  // Lashes at the outer corner.
  ctx.save();
  ctx.strokeStyle = look.lashColor;
  ctx.lineWidth = rx * 0.05;
  ctx.lineCap = 'round';
  const flip = pose.upperLid > 0.8 ? -1 : 1; // closed eyes: lashes point down
  [0.62, 0.76, 0.88].forEach((u0, k) => {
    const u = u0 * side;
    let index = 0;
    for (let i = 1; i <= steps; i++) if (Math.abs(us[i]! - u) < Math.abs(us[index]! - u)) index = i;
    const v = upper[index]!;
    if (u * u + v * v >= 1.25) return;
    const bx = px(u);
    const by = py(v);
    const len = rx * (0.16 + 0.04 * k);
    const angle = Math.PI / 2 - side * (0.5 + 0.25 * k);
    const tx = bx + Math.cos(angle) * len;
    const ty = by - Math.sin(angle) * len * flip;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(bx + Math.cos(angle) * len * 0.2, by - Math.sin(angle) * len * 0.8 * flip, tx, ty);
    ctx.stroke();
  });
  ctx.restore();
}

function drawIris(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  side: number,
  pose: EyePose,
  iris: string,
  look: LookSettings,
): void {
  const g = clampLength(pose.gaze, 1);
  // The eyes turn a little toward the nose when the person is close.
  const inward = -side * pose.convergence * 0.1;
  const ix = cx + (g.x * 0.46 + inward) * rx;
  const iy = cy - g.y * 0.4 * ry;
  const ir = Math.min(rx, ry) * 0.5 * look.irisSize;

  ctx.save();
  ctx.translate(ix, iy);
  // Perspective: the iris looks narrower when the eye turns sideways.
  ctx.scale(1 - 0.16 * Math.abs(g.x), 1 - 0.12 * Math.abs(g.y));

  if (look.irisStyle === 'glow') {
    // A glowing ring, like a robot or a creature at night.
    ctx.shadowColor = shade(iris, 0, 0.9);
    ctx.shadowBlur = ir * 0.8;
    const body = ctx.createRadialGradient(0, 0, ir * 0.2, 0, 0, ir);
    body.addColorStop(0, shade(iris, 0.7));
    body.addColorStop(0.55, shade(iris, 0));
    body.addColorStop(1, shade(iris, -0.3, 0.9));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, ir, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  } else if (look.irisStyle === 'simple') {
    // A flat cartoon iris.
    ctx.fillStyle = shade(iris, 0);
    ctx.beginPath();
    ctx.arc(0, 0, ir, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, ir, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();
    const body = ctx.createRadialGradient(0, 0, 0, 0, 0, ir);
    body.addColorStop(0.2, shade(iris, 0.45));
    body.addColorStop(0.7, shade(iris, 0));
    body.addColorStop(1, shade(iris, -0.65));
    ctx.fillStyle = body;
    ctx.fillRect(-ir, -ir, ir * 2, ir * 2);
    // Fibers.
    ctx.strokeStyle = shade(iris, 0.45, 0.22);
    ctx.lineWidth = ir * 0.025;
    ctx.beginPath();
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const wobble = Math.sin(i * 2.3) * 0.1;
      ctx.moveTo(Math.cos(a) * ir * 0.35, Math.sin(a) * ir * 0.35);
      ctx.lineTo(Math.cos(a + wobble) * ir * 0.92, Math.sin(a + wobble) * ir * 0.92);
    }
    ctx.stroke();
    ctx.restore();
    // Limbal ring.
    ctx.beginPath();
    ctx.arc(0, 0, ir * 0.95, 0, Math.PI * 2);
    ctx.strokeStyle = shade(iris, -0.65, 0.8);
    ctx.lineWidth = ir * 0.1;
    ctx.stroke();
  }

  // Pupil.
  const pr = Math.min(ir * 0.44 * pose.pupilSize * look.pupilSize, ir * 0.92);
  const pupil = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
  pupil.addColorStop(0, 'rgb(13, 10, 23)');
  pupil.addColorStop(1, 'rgb(0, 0, 5)');
  ctx.beginPath();
  if (look.pupilShape === 'slit') {
    // A cat pupil: tall and narrow. It gets rounder when the pupil is big (happy, interested).
    const widen = Math.min(1, Math.max(0, (pose.pupilSize - 0.7) / 0.7));
    ctx.ellipse(0, 0, pr * (0.28 + 0.45 * widen), Math.min(ir * 0.9, pr * 1.9), 0, 0, Math.PI * 2);
  } else {
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
  }
  ctx.fillStyle = pupil;
  ctx.fill();
  ctx.restore();

  // Highlights move less than the iris, as if they reflect a fixed light. This makes the eyes look wet.
  const hx = ix - ir * 0.32 - g.x * ir * 0.08;
  const hy = iy - ir * 0.34 + g.y * ir * 0.06;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.ellipse(hx, hy, ir * 0.2, ir * 0.16, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.arc(ix + ir * 0.3, iy + ir * 0.28, ir * 0.07, 0, Math.PI * 2);
  ctx.fill();
}

function drawBrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  side: number,
  pose: EyePose,
  color: string,
): void {
  const lift = pose.browLift;
  const tilt = pose.browTilt;
  const baseY = cy - ry * (1.28 + 0.2 * lift);
  const inner = { x: cx - side * rx * 0.75, y: baseY - tilt * rx * 0.6 };
  const outer = { x: cx + side * rx * 0.85, y: baseY + tilt * rx * 0.6 + ry * 0.05 };
  const top = { x: cx + side * rx * 0.1, y: baseY - ry * (0.18 + 0.08 * lift) };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = shade(color, 0, 0.95);
  ctx.lineWidth = rx * 0.13;
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.quadraticCurveTo(top.x, top.y, outer.x, outer.y);
  ctx.stroke();
  ctx.restore();
}

function drawCaption(ctx: CanvasRenderingContext2D, l: EyeLayout, pose: EyePose, iris: string): void {
  const alpha = pose.captionOpacity;
  if (alpha < 0.01 || !pose.caption) return;
  const size = Math.max(l.rx * 0.42, 24);
  const rise = (1 - alpha) * size * 0.5; // rises a little while fading in
  ctx.save();
  ctx.font = `600 ${size}px ui-rounded, "SF Pro Rounded", "Nunito", "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = `${size * 0.06}px`;
  ctx.shadowColor = shade(iris, 0, 0.6 * alpha);
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = `rgba(255, 255, 255, ${0.92 * alpha})`;
  ctx.fillText(pose.caption, l.cx, l.cy + l.ry * 1.75 + rise);
  ctx.restore();
}

function drawSleep(ctx: CanvasRenderingContext2D, l: EyeLayout, pose: EyePose, time: number): void {
  const sx = l.cx + l.spacing + l.rx * 0.9;
  const sy = l.cy - l.ry * 0.9;
  const cycle = 3.6;
  ctx.save();
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 3; i++) {
    const t = (((time + (i * cycle) / 3) % cycle) + cycle) % cycle / cycle;
    const alpha = pose.sleepOpacity * Math.sin(t * Math.PI);
    const size = l.rx * (0.22 + 0.25 * t);
    ctx.font = `700 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.75 * alpha})`;
    ctx.fillText('z', sx + t * l.rx * 0.9 + Math.sin(t * 6) * l.rx * 0.08, sy - t * l.ry * 1.2);
  }
  ctx.restore();
}

function drawDebug(ctx: CanvasRenderingContext2D, text: string, height: number): void {
  ctx.save();
  ctx.font = '13px ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'bottom';
  const lines = text.split('\n');
  const lineHeight = 17;
  const top = height - 16 - lines.length * lineHeight;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(12, top - 8, 520, lines.length * lineHeight + 16);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  lines.forEach((line, i) => ctx.fillText(line, 20, top + (i + 1) * lineHeight));
  ctx.restore();
}
