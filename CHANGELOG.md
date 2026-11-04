# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
