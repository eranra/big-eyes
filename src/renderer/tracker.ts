import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { faceFromLandmarks, type FaceObservation } from '../core/face';
import { chooseCamera } from '../core/camera';
import type { CameraInfo } from '../core/ipc';
import type { Settings } from '../core/settings';

/**
 * Reads the camera and finds faces with MediaPipe Face Landmarker. Everything runs on this computer.
 * No frames are stored or sent anywhere.
 */
export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private loading: Promise<FaceLandmarker> | null = null;
  private video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private running = false;
  /** id and label of the requested camera, to skip restarts when nothing changed. */
  private cameraId: string | null = null;
  private lastVideoTime = -1;
  private lastDetect = 0;
  private frameHandle = 0;
  /** About 20 detections per second is enough for smooth eyes and saves energy. */
  private readonly minInterval = 1000 / 20;

  onFaces: (faces: FaceObservation[], time: number) => void = () => {};
  onError: (message: string) => void = () => {};

  constructor(private readonly baseUrl: string) {
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
  }

  /** Lists video input devices. Labels are empty until camera permission is granted once. */
  static async listCameras(): Promise<CameraInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  private load(): Promise<FaceLandmarker> {
    this.loading ??= (async () => {
      const fileset = await FilesetResolver.forVisionTasks(`${this.baseUrl}wasm`);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: `${this.baseUrl}models/face_landmarker.task`, delegate },
        runningMode: 'VIDEO' as const,
        numFaces: 3,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        return await FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
    })();
    return this.loading;
  }

  /** Label of the camera that is open now, or null. */
  get activeCameraLabel(): string | null {
    return this.stream?.getVideoTracks()[0]?.label ?? null;
  }

  /** Starts the camera chosen by the settings (see `chooseCamera`) and face tracking. */
  async start(camera: Pick<Settings, 'cameraId' | 'cameraLabel' | 'cameraKind'>): Promise<void> {
    const key = `${camera.cameraId ?? ''}|${camera.cameraLabel ?? ''}|${camera.cameraKind}`;
    if (this.running && key === this.cameraId) return;
    this.stop();
    this.running = true;
    this.cameraId = key;
    try {
      const [landmarker, stream] = await Promise.all([this.load(), this.openCamera(camera)]);
      if (!this.running) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.landmarker = landmarker;
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      this.loop();
    } catch (error) {
      this.running = false;
      this.onError(describeError(error));
    }
  }

  private async openCamera(camera: Pick<Settings, 'cameraId' | 'cameraLabel' | 'cameraKind'>): Promise<MediaStream> {
    const video: MediaTrackConstraints = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } };
    // Labels are empty until camera access is granted once. Ask with the default camera, then choose.
    let cameras = await FaceTracker.listCameras();
    if (cameras.length && cameras.every((c) => /^Camera \d+$/.test(c.label))) {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
      cameras = await FaceTracker.listCameras();
    }
    const deviceId = chooseCamera(cameras, camera);
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video: { ...video, deviceId: { exact: deviceId } }, audio: false });
      } catch {
        // The camera is busy or gone. Use the system default below.
      }
    }
    return navigator.mediaDevices.getUserMedia({ video, audio: false });
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameHandle);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.lastVideoTime = -1;
  }

  private loop = (): void => {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (!this.landmarker || this.video.readyState < 2 || now - this.lastDetect < this.minInterval) return;
    if (this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    this.lastDetect = now;
    try {
      const result = this.landmarker.detectForVideo(this.video, now);
      const faces: FaceObservation[] = [];
      result.faceLandmarks.forEach((landmarks, i) => {
        const face = faceFromLandmarks(
          landmarks,
          result.faceBlendshapes?.[i]?.categories,
          result.facialTransformationMatrixes?.[i]?.data,
        );
        if (face) faces.push(face);
      });
      this.onFaces(faces, now / 1000);
    } catch (error) {
      this.onError(describeError(error));
    }
  };
}

function describeError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'Camera access was denied. Allow camera access for Big Eyes in your system settings.';
    if (error.name === 'NotFoundError') return 'No camera found.';
    if (error.name === 'NotReadableError') return 'The camera is in use by another app.';
  }
  return `Face tracking error: ${error instanceof Error ? error.message : String(error)}`;
}
