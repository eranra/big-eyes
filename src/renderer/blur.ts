import type { BigEyesApi } from '../core/ipc';

declare global {
  interface Window {
    bigEyes: BigEyesApi;
  }
}

/** Blur-only window for screens without eyes. It only fades its tint in and out. */
const api = window.bigEyes;
api.onBlur((on) => document.body.classList.toggle('on', on));
api.onSettings((s) => document.documentElement.style.setProperty('--blur', String(s.blurStrength)));
void api.getSettings().then((s) => document.documentElement.style.setProperty('--blur', String(s.blurStrength)));
