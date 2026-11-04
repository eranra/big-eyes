# Privacy

Big Eyes uses your camera. This page says exactly what happens with it.

- **On-device only.** Camera frames are processed by MediaPipe inside the app, on your computer.
  No frame, face data or number derived from it is sent over the network.
- **One network request: the update check.** At start and every 6 hours the app downloads a small text file
  (`latest-mac.yml`, `latest.yml` or `latest-linux.yml`) from github.com to see the newest version number.
  On Windows and Linux AppImage it also downloads the update itself. Turn this off with
  *Check for Updates Automatically*.
- **MediaPipe's usage logging is blocked.** The MediaPipe library has a built-in logger that tries to send usage
  statistics to Google (`odml.pa.googleapis.com`). Big Eyes blocks it twice: the page security policy allows no
  outside connections, and the app cancels requests to Google's logging hosts.
- **Nothing is saved.** Frames are not stored. The only data saved is `settings.json`, which contains your settings
  and the calibration values (three numbers: head yaw, head pitch, and eye direction).
- **Camera only while visible, plus a short check.** The camera starts when the eyes appear and stops when they go away.
  With *Wait while I'm looking* on (the default), the camera also runs for about 3 seconds when the idle time is
  reached, to see whether someone is reading the screen; while someone is there, this repeats every 15 seconds.
  Your system's camera indicator (for example the green light on a Mac) shows when it runs.
- **No microphone.** The app never asks for audio.
- **You can turn it off.** Pause the app from the tray menu, or remove camera access in your system settings.

The face model file is downloaded once at build time from Google's MediaPipe model storage and is checked by SHA-256.
