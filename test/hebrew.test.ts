import { describe, expect, it } from 'vitest';
import { HAPPY_MESSAGES, HAPPY_MESSAGES_HE, messagesFor } from '../src/core/inspirations';

describe('Hebrew messages', () => {
  it('has a full Hebrew list', () => {
    expect(HAPPY_MESSAGES_HE.length).toBeGreaterThanOrEqual(20);
    for (const m of HAPPY_MESSAGES_HE) expect(m.length).toBeGreaterThan(2);
    expect(HAPPY_MESSAGES_HE).toContain('אתה מדהים!');
    // Parallel to the English list, and Hebrew-only characters plus neutral punctuation:
    // a stray Latin letter or digit would break the right-to-left rendering assumption.
    expect(HAPPY_MESSAGES_HE.length).toBe(HAPPY_MESSAGES.length);
    for (const m of HAPPY_MESSAGES_HE) expect(m).toMatch(/^[\u0590-\u05FF\s!—,'?]+$/);
  });

  it('messagesFor picks the list by language', async () => {
    const { HAPPY_MESSAGES } = await import('../src/core/inspirations');
    expect(messagesFor({ messageLanguage: 'he' })).toBe(HAPPY_MESSAGES_HE);
    expect(messagesFor({ messageLanguage: 'en' })).toBe(HAPPY_MESSAGES);
  });

  it('the settings round-trip validates the language', async () => {
    const { defaultSettings, mergeSettings, normalizeSettings } = await import('../src/core/settings');
    expect(defaultSettings().messageLanguage).toBe('en');
    expect(mergeSettings(defaultSettings(), { messageLanguage: 'he' }).messageLanguage).toBe('he');
    expect(normalizeSettings({ messageLanguage: 'fr' }).messageLanguage).toBe('en');
  });

  it('the scheduler marks Hebrew messages as right-to-left', async () => {
    const { InspirationScheduler } = await import('../src/core/inspirations');
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const s = mergeSettings(defaultSettings(), { messageLanguage: 'he', inspirationsInterval: 3 });
    const sched = new InspirationScheduler(s, 1);
    let message = null;
    for (let t = 0; t < 10; t += 1 / 60) {
      message = sched.update(t, true);
      if (message) break;
    }
    expect(message).not.toBeNull();
    expect(message!.rtl).toBe(true);
    expect(message!.text).toContain('א');
  });

  it('English messages are not right-to-left', async () => {
    const { InspirationScheduler } = await import('../src/core/inspirations');
    const { defaultSettings } = await import('../src/core/settings');
    const sched = new InspirationScheduler(defaultSettings(), 1);
    let message = null;
    for (let t = 0; t < 12; t += 1 / 60) {
      message = sched.update(t, true);
      if (message) break;
    }
    expect(message).not.toBeNull();
    expect(message!.rtl).toBe(false);
  });

  it('switching the language mid-run: the next message comes from the new list with matching rtl', async () => {
    const { InspirationScheduler, HAPPY_MESSAGES, HAPPY_MESSAGES_HE } = await import('../src/core/inspirations');
    const { defaultSettings, mergeSettings } = await import('../src/core/settings');
    const s = mergeSettings(defaultSettings(), { inspirationsInterval: 3, inspirationsDuration: 5 });
    const sched = new InspirationScheduler(s, 9);
    // An English message shows.
    let first = null;
    for (let t = 0; t < 10; t += 1 / 60) {
      first = sched.update(t, true);
      if (first) break;
    }
    expect(first).not.toBeNull();
    expect(HAPPY_MESSAGES).toContain(first!.text);
    expect(first!.rtl).toBe(false);
    // The user switches to Hebrew mid-run.
    sched.settings = { ...sched.settings, messageLanguage: 'he' };
    let next = null;
    for (let t = 20; t < 40; t += 1 / 60) {
      next = sched.update(t, true);
      if (next && next.text !== first!.text) break;
    }
    expect(next).not.toBeNull();
    expect(HAPPY_MESSAGES_HE).toContain(next!.text);
    expect(next!.rtl).toBe(true);
  });

  it('drawInspiration renders right-to-left text in rtl direction', async () => {
    const { drawEyes } = await import('../src/renderer/draw');
    const { staticPose } = await import('../src/core/animator');
    const { defaultSettings } = await import('../src/core/settings');
    const directions: string[] = [];
    const ctx = {
      fill: () => {}, stroke: () => {}, save() {}, restore() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, bezierCurveTo() {}, quadraticCurveTo() {}, ellipse() {}, arc() {},
      clip() {}, rect() {}, roundRect() {}, fillRect() {}, clearRect() {}, translate() {}, rotate() {},
      scale() {}, setTransform() {}, fillText() {}, strokeText() {},
      measureText: () => ({ width: 10 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperty(ctx, 'direction', {
      get: () => 'inherit',
      set: (v: string) => directions.push(v),
    });
    const settings = defaultSettings();
    const pose = staticPose('sleeping', settings);
    pose.inspiration = { text: 'אתה מדהים!', position: 'center', opacity: 1, colorIndex: 0, sizeFactor: 1, startTime: 0, rtl: true };
    drawEyes(ctx, 900, 700, pose, { irisColor: '#3d85dc', look: settings.look, eyeSize: 1, time: 1 });
    expect(directions).toContain('rtl');
  });
});
