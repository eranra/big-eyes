import { FaceLandmarker, FilesetResolver, type FaceLandmarkerOptions } from '@mediapipe/tasks-vision';
import { chooseCameras } from '../core/camera';
import { faceFromLandmarks, type FaceObservation } from '../core/face';
import type { CameraInfo } from '../core/ipc';
import type { CameraChoice } from '../core/settings';

/** One open camera with its own MediaPipe landmarker (VIDEO mode needs one per video stream). */
interface CameraStream {
  index: number;
  label: string;
  deviceId: string;
  stream: MediaStream;
  video: HTMLVideoElement;
  landmarker: FaceLandmarker;
  lastVideoTime: number;
  lastTimestamp: number;
}

/**
 * Reads one or more cameras and finds faces with MediaPipe Face Landmarker. Everything runs on this computer.
 * No frames are stored or sent anywhere.
 *
 * With several cameras, each frame of the loop processes the next camera in turn, so the work per
 * frame stays the same. Faces are tagged with the camera index (0 = main camera).
 */
export class FaceTracker {
  private fileset: Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>> | null = null;
  private delegate: 'GPU' | 'CPU' = 'GPU';
  private streams: CameraStream[] = [];
  private running = false;
  private startKey: string | null = null;
  private startToken = 0;
  private frameHandle = 0;
  private lastDetect = 0;
  private next = 0;
  /** Latest faces per camera, so every report contains all cameras. */
  private latest = new Map<number, { faces: FaceObservation[]; time: number }>();
  /** About 20 detections per second in total is enough for smooth eyes. */
  private readonly minInterval = 1000 / 20;

  /** Faces of all cameras (latest per camera) and the indexes of the cameras whose frames are included. */
  onFaces: (faces: FaceObservation[], time: number, cameras: number[]) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(private readonly baseUrl: string) {}

  /** Lists video input devices. Labels are empty until camera permission is granted once. */
  static async listCameras(): Promise<CameraInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  /** Labels of the cameras that are open now. */
  get activeCameraLabels(): string[] {
    return this.streams.map((s) => s.label);
  }

  /** The cameras that are open now: index, name and device id. */
  get openCameras(): Array<{ index: number; label: string; id: string }> {
    return this.streams.map((s) => ({ index: s.index, label: s.label, id: s.deviceId }));
  }

  private async createLandmarker(): Promise<FaceLandmarker> {
    this.fileset ??= FilesetResolver.forVisionTasks(`${this.baseUrl}wasm`);
    const fileset = await this.fileset;
    const options = (delegate: 'GPU' | 'CPU'): FaceLandmarkerOptions => ({
      baseOptions: { modelAssetPath: `${this.baseUrl}models/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 3,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, options(this.delegate));
    } catch {
      this.delegate = 'CPU';
      return FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  /** Starts the cameras chosen by the settings and face tracking. */
  async start(choice: CameraChoice): Promise<void> {
    const key = JSON.stringify(choice);
    if (this.running && key === this.startKey) return;
    this.stop();
    this.running = true;
    this.startKey = key;
    const token = ++this.startToken;
    try {
      const ids = await this.resolveIds(choice);
      const opened: CameraStream[] = [];
      // Open one by one: some systems fail when two cameras start at the same moment.
      for (const id of ids.length ? ids : [null]) {
        try {
          const stream = await openCamera(id);
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await video.play();
          const landmarker = await this.createLandmarker();
          const track = stream.getVideoTracks()[0];
          const label = track?.label ?? 'Camera';
          const deviceId = track?.getSettings().deviceId ?? id ?? '';
          opened.push({ index: opened.length, label, deviceId, stream, video, landmarker, lastVideoTime: -1, lastTimestamp: 0 });
        } catch (error) {
          // One camera failing (busy, unplugged) must not stop the others.
          if (ids.length <= 1) throw error;
          console.warn('[big-eyes] could not open a camera:', describeError(error));
        }
        if (token !== this.startToken) break;
      }
      if (token !== this.startToken || !this.running) {
        closeStreams(opened);
        return;
      }
      if (!opened.length) throw new DOMException('No camera could be opened', 'NotReadableError');
      this.streams = opened;
      this.loop();
    } catch (error) {
      if (token === this.startToken) {
        this.running = false;
        this.onError(describeError(error));
      }
    }
  }

  private async resolveIds(choice: CameraChoice): Promise<string[]> {
    let cameras = await FaceTracker.listCameras();
    // Names are hidden until camera access is granted once. Open the default camera briefly, then list again.
    if (choice.mode !== 'default' && cameras.length && cameras.every((c) => /^Camera \d+$/.test(c.label))) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
      cameras = await FaceTracker.listCameras();
    }
    return chooseCameras(cameras, choice);
  }

  stop(): void {
    this.running = false;
    this.startToken++;
    cancelAnimationFrame(this.frameHandle);
    closeStreams(this.streams);
    this.streams = [];
    this.latest.clear();
  }

  private loop = (): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (!this.streams.length || now - this.lastDetect < this.minInterval) return;
    // Next camera in turn. Skip cameras without a new frame.
    for (let tries = 0; tries < this.streams.length; tries++) {
      const cam = this.streams[this.next % this.streams.length]!;
      this.next++;
      if (cam.video.readyState < 2 || cam.video.currentTime === cam.lastVideoTime) continue;
      cam.lastVideoTime = cam.video.currentTime;
      this.lastDetect = now;
      this.detect(cam, now);
      break;
    }
  };

  private detect(cam: CameraStream, now: number): void {
    try {
      // Timestamps must grow for each landmarker.
      const timestamp = Math.max(now, cam.lastTimestamp + 1);
      cam.lastTimestamp = timestamp;
      const result = cam.landmarker.detectForVideo(cam.video, timestamp);
      const faces: FaceObservation[] = [];
      result.faceLandmarks.forEach((landmarks, i) => {
        const face = faceFromLandmarks(landmarks, result.faceBlendshapes?.[i]?.categories, result.facialTransformationMatrixes?.[i]?.data);
        if (face) faces.push({ ...face, camera: cam.index });
      });
      const time = now / 1000;
      this.latest.set(cam.index, { faces, time });
      // Report all cameras' latest faces. Drop results older than half a second.
      const all: FaceObservation[] = [];
      const fresh: number[] = [];
      for (const [index, entry] of this.latest) {
        if (time - entry.time >= 0.5) continue;
        all.push(...entry.faces);
        fresh.push(index);
      }
      this.onFaces(all, time, fresh);
    } catch (error) {
      this.onError(describeError(error));
    }
  }
}

async function openCamera(deviceId: string | null): Promise<MediaStream> {
  const video: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: { exact: deviceId } }, audio: false });
    } catch {
      // The camera is busy or gone. Use the system default below.
    }
  }
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function closeStreams(streams: readonly CameraStream[]): void {
  for (const s of streams) {
    s.stream.getTracks().forEach((t) => t.stop());
    s.video.srcObject = null;
    s.landmarker.close();
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera access was denied. Allow camera access for Big Eyes in your system settings.';
    if (error.name === 'NotFoundError') return 'No camera found.';
    if (error.name === 'NotReadableError') return 'The camera is in use by another app.';
  }
  return `Face tracking error: ${error instanceof Error ? error.message : String(error)}`;
}
