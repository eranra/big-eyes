import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type BigEyesApi, type OverlayRole } from '../core/ipc';

function readRole(): OverlayRole | null {
  const arg = process.argv.find((a) => a.startsWith('--big-eyes-role='));
  if (!arg) return null;
  try {
    return JSON.parse(arg.slice('--big-eyes-role='.length)) as OverlayRole;
  } catch {
    return null;
  }
}

/** Only a narrow, typed API reaches the page. The page never gets direct access to Node or ipcRenderer. */
const api: BigEyesApi = {
  role: readRole(),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  resetSettings: () => ipcRenderer.invoke(IPC.resetSettings),
  getDisplays: () => ipcRenderer.invoke(IPC.getDisplays),
  onSettings: (listener) => void ipcRenderer.on(IPC.settings, (_e, s) => listener(s)),
  onVisibility: (listener) => void ipcRenderer.on(IPC.visibility, (_e, v) => listener(Boolean(v))),
  onBlur: (listener) => void ipcRenderer.on(IPC.blur, (_e, on) => listener(Boolean(on))),
  onCalibrate: (listener) => void ipcRenderer.on(IPC.calibrate, () => listener()),
  onFaces: (listener) => void ipcRenderer.on(IPC.facesBroadcast, (_e, m) => listener(m)),
  onPresenceCheck: (listener) => void ipcRenderer.on(IPC.presenceCheck, (_e, active) => listener(Boolean(active))),
  sendPresenceFaces: (message) => ipcRenderer.send(IPC.presenceFaces, message),
  onStatus: (listener) => void ipcRenderer.on(IPC.status, (_e, m) => listener(String(m))),
  sendFaces: (message) => ipcRenderer.send(IPC.faces, message),
  sendCameras: (cameras) => ipcRenderer.send(IPC.cameras, cameras),
  sendCalibrated: (reference) => ipcRenderer.send(IPC.calibrated, reference),
  sendStatus: (message) => ipcRenderer.send(IPC.status, message),
  sendLog: (message) => ipcRenderer.send(IPC.log, message),
  sendEyeArea: (rect) => ipcRenderer.send(IPC.eyeArea, rect),
  requestClose: () => ipcRenderer.send(IPC.requestClose),
  preview: () => ipcRenderer.send(IPC.preview),
  getAbout: () => ipcRenderer.invoke(IPC.getAbout),
  onAboutUpdate: (listener) => void ipcRenderer.on(IPC.aboutUpdate, (_e, info) => listener(info)),
  checkUpdates: () => ipcRenderer.send(IPC.checkUpdates),
  openLink: (url) => ipcRenderer.send(IPC.openLink, url),
  calibrate: () => ipcRenderer.send(IPC.requestCalibrate),
};

contextBridge.exposeInMainWorld('bigEyes', api);
