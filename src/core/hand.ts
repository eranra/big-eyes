import type { Mood } from './mood';
import type { ActiveInspiration } from './inspirations';

export type HandGesture = 'rest' | 'wave' | 'clap' | 'cover' | 'point' | 'droop';

export interface HandPose {
  gesture: HandGesture;
  lift: number;
  spread: number;
  rotation: number;
  opacity: number;
  yJitter: number;
}

export interface HandSettings {
  showHands: boolean;
}

const MOOD_GESTURE: Record<Mood, HandGesture> = {
  sleeping: 'wave',
  surprised: 'cover',
  curious: 'rest',
  happy: 'clap',
  delighted: 'clap',
  bored: 'droop',
};

export function defaultHandSettings(): HandSettings {
  return { showHands: false };
}

export class HandScheduler {
  pose: HandPose = { gesture: 'rest', lift: 0, spread: 0, rotation: 0, opacity: 0, yJitter: 0 };
  private settings: HandSettings;

  constructor(settings: HandSettings, _seed = 1) {
    this.settings = settings;
  }

  update(now: number, mood: Mood, inspiration: ActiveInspiration | null, showHands: boolean): HandPose {
    if (!showHands || !this.settings.showHands) {
      this.pose = { gesture: 'rest', lift: 0, spread: 0, rotation: 0, opacity: 0, yJitter: 0 };
      return this.pose;
    }
    let gesture: HandGesture = MOOD_GESTURE[mood] ?? 'rest';
    if (inspiration) gesture = 'point';
    let lift = 0;
    let spread = 0;
    let rotation = 0;
    if (gesture === 'wave') {
      lift = Math.sin(now * 1.4) * 0.25 + 0.35;
      rotation = Math.sin(now * 1.4) * 8;
    } else if (gesture === 'clap') {
      spread = Math.abs(Math.sin(now * 3.5)) * 0.5 + 0.1;
      lift = 0.3;
    } else if (gesture === 'cover') {
      lift = 0.9;
      spread = 0.05;
    } else if (gesture === 'point') {
      lift = 0.55;
      rotation = 10;
      spread = 0.08;
    } else if (gesture === 'droop') {
      lift = -0.15;
      rotation = -12;
    } else {
      lift = 0.08;
      spread = 0.08;
    }
    const yJitter = Math.sin(now * 0.6) * 2 + Math.sin(now * 1.1) * 1;
    this.pose = { gesture, lift, spread, rotation, opacity: 1, yJitter };
    return this.pose;
  }
}
