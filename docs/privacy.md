# Privacy

Big Eyes uses your camera. This page says exactly what happens with it.

- **On-device only.** Camera frames are processed by MediaPipe inside the app, on your computer.
  No frame, face data or number derived from it is sent over the network. The app makes no network requests.
- **Nothing is saved.** Frames are not stored. The only data saved is `settings.json`, which contains your settings
  and the calibration values (three numbers: head yaw, head pitch, and eye direction).
- **Camera only while visible.** The camera starts when the eyes appear and stops when they go away.
  Your system's camera indicator (for example the green light on a Mac) shows when it runs.
- **No microphone.** The app never asks for audio.
- **You can turn it off.** Pause the app from the tray menu, or remove camera access in your system settings.

The face model file is downloaded once at build time from Google's MediaPipe model storage and is checked by SHA-256.
