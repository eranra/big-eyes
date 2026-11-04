# Third-party notices

Big Eyes ships with these third-party components:

| Component | License | Use |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | Desktop app runtime (includes Chromium and Node.js, see their bundled license files) |
| [MediaPipe Tasks Vision](https://github.com/google-ai-edge/mediapipe) (`@mediapipe/tasks-vision`) | Apache-2.0 | Face landmark detection (WebAssembly) |
| [MediaPipe Face Landmarker model](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker) (`face_landmarker.task`) | Apache-2.0 | Face, iris and blendshape model, downloaded by `npm run fetch-model` |

The model card for the Face Landmarker model is published by Google with the model.
