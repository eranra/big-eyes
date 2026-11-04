# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.2] - 2026-11-04

### Added

- **Blur behind the eyes**: when the eyes replace the screen saver, the normal eyes appear as usual, and once the
  screen saver time is reached the screen behind them is blurred at full strength. Turn it off in
  **Screen Saver → Blur the Screen Behind the Eyes**, or choose blur always. The strength can be lowered.
- **Screen Saver Starts After**: same as the system, or a fixed time. The system time is read at start and when it
  changes (no polling): macOS managed (IT) policy, then System Settings, then display sleep; Windows group policy,
  then the screen saver setting, then the monitor-off time; Linux GNOME idle delay or KDE screen locker timeout.
  macOS uses the system blur, Windows 11 uses acrylic, Linux uses a strong tint.
- A log file of app events (shows, hides and why, camera checks, locks, sleeps), for finding problems later:
  `~/Library/Logs/Big Eyes/main.log` on macOS. No images or face data are written.

## [0.3.1] - 2026-11-04

### Fixed

- *Wait while I'm looking* now uses the same eye-contact detection as the eyes and look-to-close. Before, any face
  turned roughly toward the screen counted, so looking at a phone kept the eyes away.
- After the eyes were dismissed (for example by look-to-close), camera checks no longer repeat until new input.

### Changed

- *Wait While I'm Looking at the Screen* moved into the **Show After** menu.

## [0.3.0] - 2026-11-04

### Added

- **Wait while I'm looking** (on by default): before the eyes appear, a short camera check sees whether someone is
  looking at the screen; if so, the eyes wait.
- **Screen saver** setting: pause the eyes during the screen saver (default), or let the eyes replace it.
- **About Big Eyes** window with the version, links to GitHub, and a Check for Updates button.
- **Updates:** automatic checks at start and every 6 hours, and **Check for Updates…** in the menu. Windows and
  Linux AppImage download and install updates; macOS and .deb show the new release with a link.

- Idle detection ignores tiny mouse jitter (moves of a few pixels), which some wireless mice send while they lie still.

### Security

- Requests to Google's logging hosts (MediaPipe's built-in usage logger) are blocked in the app, in addition to the
  page security policy.

## [0.2.0] - 2026-11-04

### Added

- Several cameras at once: built-in, system default, all cameras, or a chosen list. The first chosen camera is the
  main camera (position and eye contact); the others keep the person present when the main camera loses them.
- Smile recognition and smile back: when you smile while looking at the eyes, they smile back ("delighted" mood)
  with a big open smile, crescent eyes and a bounce.
- An animated mouth under the eyes for every mood (smile, frown, surprised "o"), with a lip color per theme.
- Settings: Smile Back, Show Mouth, lip color; camera test shows every chosen camera.

### Changed

- Settings files from 0.1.0 are converted: `cameraKind` / `cameraId` / `cameraLabel` become `cameras`.

## [0.1.0] - 2026-11-04

### Added

- Overlay eyes that appear after an idle time, on chosen screens, and hide on any input.
- Head and eye tracking with MediaPipe Face Landmarker; eyes follow the person and move toward them.
- Moods: sleeping, surprised, curious, happy ("Welcome"), bored ("Bored"); the eyes smile more when you smile.
- Natural motion: springs, saccades, micro-saccades, blinks, breathing, eyebrows.
- Tray menu and Settings window: eye size, color, background, camera, screens, wait time, texts, mirror,
  open at login, pause, eye contact calibration. Settings are saved to `settings.json`.
- Looks: five themes (Classic, Cartoon, Robot, Cat, Spooky) and custom colors, iris style, eye shape,
  pupil shape and size, spacing, eyebrows, lashes and cheeks.
- The eyes hide when the mouse moves onto them, or on any key press or click. Mouse movement elsewhere is allowed.
- Defaults: appear after 30 seconds, on the built-in screen, using the built-in camera, without text.
- One-line macOS installer (`install.sh`), ad-hoc signed `.dmg`, Windows installer, Linux AppImage and `.deb`.
- Apache License 2.0.
- Position setting: center or any corner.
- Blinking settings: how often and how fast.
- Closing settings: mouse onto the eyes (default), any mouse movement, or never.
- Look-to-close (optional): hold eye contact, a ring fills up, the eyes wink and close.
- Test options: `--show-eyes`, `--debug-eyes`, `--stay-eyes`, `--internal-screen-only`, `--camera-name=`, `--guided-test`.
