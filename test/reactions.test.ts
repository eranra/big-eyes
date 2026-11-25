import { describe, expect, it } from 'vitest';

/** Shared mock canvas. */
function mockCtx() {
  const fills: number[] = [];
  return {
    ctx: {
      fill: () => fills.push(1), stroke: () => {}, save() {}, restore() {}, beginPath() {},
      closePath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {},
      ellipse() {}, arc() {}, clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {},
      translate() {}, rotate() {}, scale() {}, setTransform() {}, fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D,
    fills,
  };
}

describe('animator reactions', () => {
  it('a relieved reaction (charging) raises a soft smile for a moment', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    const a = new EyeAnimator(defaultSettings(), 1);
    const baseline = a.update(0).smile;
    a.react('relieved', 0.1);
    let maxSmile = 0;
    for (let t = 0.1; t < 3; t += 1 / 60) maxSmile = Math.max(maxSmile, a.update(t).smile);
    expect(maxSmile).toBeGreaterThan(Math.max(0.4, baseline + 0.3));
    // ...and it passes.
    for (let t = 3; t < 6; t += 1 / 60) a.update(t);
    expect(a.pose.smile).toBeLessThan(0.3);
  });

  it('a squint reaction (screenshot) briefly closes the lids', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    const a = new EyeAnimator(defaultSettings(), 2);
    a.react('squint', 0.1);
    let maxLid = 0;
    for (let t = 0.1; t < 1.6; t += 1 / 60) maxLid = Math.max(maxLid, a.update(t).upperLid);
    expect(maxLid).toBeGreaterThan(0.5);
    for (let t = 1.6; t < 4; t += 1 / 60) a.update(t);
    expect(a.pose.upperLid).toBeLessThan(0.4);
  });

  it('music makes the eyes bob gently', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    const a = new EyeAnimator(defaultSettings(), 3);
    a.setMusic(true);
    const scales: number[] = [];
    for (let t = 0; t < 4; t += 1 / 60) scales.push(a.update(t).scale);
    const quiet = new EyeAnimator(defaultSettings(), 3);
    const quietScales: number[] = [];
    for (let t = 0; t < 4; t += 1 / 60) quietScales.push(quiet.update(t).scale);
    // The bob shows up as a clear rhythm at ~2.4 Hz: the scale crosses its midpoint often.
    const mid = (Math.max(...scales) + Math.min(...scales)) / 2;
    let crossings = 0;
    for (let i = 1; i < scales.length; i++) {
      if ((scales[i - 1]! - mid) * (scales[i]! - mid) < 0) crossings++;
    }
    const quietMid = (Math.max(...quietScales) + Math.min(...quietScales)) / 2;
    let quietCrossings = 0;
    for (let i = 1; i < quietScales.length; i++) {
      if ((quietScales[i - 1]! - quietMid) * (quietScales[i]! - quietMid) < 0) quietCrossings++;
    }
    expect(crossings).toBeGreaterThan(quietCrossings);
    expect(crossings).toBeGreaterThanOrEqual(3); // at least 3 bob cycles in 4 s
    expect(Math.max(...scales) - Math.min(...scales)).toBeGreaterThan(0.015); // visible
  });

  it('turning music off stops the bob', async () => {
    const { EyeAnimator, defaultSettings } = await import('../src/core');
    const a = new EyeAnimator(defaultSettings(), 4);
    a.setMusic(true);
    for (let t = 0; t < 2; t += 1 / 60) a.update(t);
    a.setMusic(false);
    // Wait for the bob spring to settle, then the swing is calm again.
    for (let t = 2; t < 4; t += 1 / 60) a.update(t);
    const scales: number[] = [];
    for (let t = 4; t < 7; t += 1 / 60) scales.push(a.update(t).scale);
    const mid = (Math.max(...scales) + Math.min(...scales)) / 2;
    let crossings = 0;
    for (let i = 1; i < scales.length; i++) {
      if ((scales[i - 1]! - mid) * (scales[i]! - mid) < 0) crossings++;
    }
    expect(crossings).toBeLessThanOrEqual(2);
  });
});

describe('system probes (pure parsers)', () => {
  it('parses the macOS battery status', async () => {
    const { parsePowerSource } = await import('../src/main/system');
    expect(parsePowerSource("Now drawing from 'AC Power'\n-InternalBattery-0 62%")).toBe(true);
    expect(parsePowerSource("Now drawing from 'Battery Power'\n-InternalBattery-0 62%")).toBe(false);
    expect(parsePowerSource('')).toBe(false);
  });

  it('parses the macOS assertions for audio (no-idle-sleep)', async () => {
    const { parseAudioPlaying } = await import('../src/main/system');
    expect(
      parseAudioPlaying(
        'Listed by owning process:\n    pid 409 (Spotify): [0x0c00000900000001] NoIdleSleepAssertion 00:00:02  named: "Spotify audio"',
      ),
    ).toBe(true);
    expect(
      parseAudioPlaying('    pid 123 (SomeApp): [0x0c...] PreventUserIdleDisplaySleep 01:00:00  named: "video"'),
    ).toBe(false);
    expect(parseAudioPlaying('Assertion status system-wide:\n   (nothing)')).toBe(false);
  });

  it('recognizes a screenshot file name', async () => {
    const { isScreenshotName } = await import('../src/main/system');
    expect(isScreenshotName('Screenshot 2026-11-19 at 10.00.00.png')).toBe(true);
    expect(isScreenshotName('Screenshot 2026-11-19 at 10.00.00.jpg')).toBe(true);
    expect(isScreenshotName('photo.png')).toBe(false);
    expect(isScreenshotName('Screen Shot 2026-01-01.png')).toBe(true);
  });
});
