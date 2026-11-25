import { describe, expect, it } from 'vitest';
import { DreamScheduler } from '../src/core/dreams';

describe('DreamScheduler', () => {
  it('spawns nothing while awake', () => {
    const d = new DreamScheduler(1);
    expect(d.update(0, false)).toBeNull();
    expect(d.update(10, false)).toBeNull();
  });

  it('spawns a bubble a few seconds after falling asleep', () => {
    const d = new DreamScheduler(2);
    let bubble = null;
    for (let t = 0; t < 12; t += 1 / 60) {
      bubble = d.update(t, true);
      if (bubble) break;
    }
    expect(bubble).not.toBeNull();
    expect(bubble!.kind === 'star' || bubble!.kind === 'heart').toBe(true);
    expect(bubble!.startTime).toBeGreaterThan(4);
  });

  it('bubbles are spaced at least 5 seconds apart', () => {
    const d = new DreamScheduler(3);
    const starts: number[] = [];
    let last: ReturnType<DreamScheduler['update']> = null;
    for (let t = 0; t < 40; t += 1 / 60) {
      const b = d.update(t, true);
      if (b && (!last || b.startTime !== last.startTime)) {
        starts.push(b.startTime);
        last = b;
      }
    }
    expect(starts.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(5);
    }
  });

  it('waking up resets the timer', () => {
    const d = new DreamScheduler(4);
    for (let t = 0; t < 8; t += 1 / 60) d.update(t, true); // sleeping, maybe a bubble
    for (let t = 8; t < 9; t += 1 / 60) d.update(t, false); // awake
    // Right after falling asleep again, no instant bubble: the wait starts over.
    expect(d.update(9.02, true)).toBeNull();
  });

  it('the bubble carries its start time for drawing its age', () => {
    const d = new DreamScheduler(5);
    let bubble = null;
    let at = 0;
    for (let t = 0; t < 12; t += 1 / 60) {
      bubble = d.update(t, true);
      if (bubble) {
        at = t;
        break;
      }
    }
    expect(bubble).not.toBeNull();
    expect(Math.abs(at - bubble!.startTime)).toBeLessThan(0.05);
  });

  it('the animator surfaces dreams in the pose while sleeping', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    const a = new EyeAnimator(defaultSettings(), 11);
    let sawDream = false;
    for (let t = 0; t < 20; t += 1 / 60) {
      if (a.update(t).dream) sawDream = true;
    }
    expect(a.mood).toBe('sleeping');
    expect(sawDream).toBe(true);
  });

  it('drawDreams renders a bubble', async () => {
    const { drawDreams, eyeLayout } = await import('../src/renderer/draw');
    const { staticPose } = await import('../src/core/animator');
    const { defaultSettings } = await import('../src/core/settings');
    const fills: number[] = [];
    const ctx = {
      fill: () => fills.push(1), stroke: () => {}, save() {}, restore() {}, beginPath() {},
      closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      ellipse() {}, arc() {}, clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {},
      translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;
    const settings = defaultSettings();
    const pose = staticPose('sleeping', settings);
    pose.dream = { kind: 'heart', startTime: 0 };
    const l = eyeLayout(900, 700, pose, 1, settings.look, 'center');
    drawDreams(ctx, l, pose.dream, 1.5);
    expect(fills.length).toBeGreaterThan(0);
  });
});
