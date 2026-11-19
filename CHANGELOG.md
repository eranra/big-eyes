# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.6.5] - 2026-11-19

### Fixed

- **Pink at the sides of the smiling mouth — the real culprit:** the cheek blush. Its pink ellipses hung
  under the outer eye halves but reached down to the mouth corners, reading as a tongue coming out the
  sides. The blush now sits right under each eye — clearly cheeks — smaller and softer, and nothing pink
  reaches the mouth any more. (The tongue itself was already centered; it never was the cause.)

## [0.6.4] - 2026-11-19

### Fixed

- **"Tongue" at the sides of the happy smile:** those were the corner dimple strokes — small pink curves
  outside both lip corners that read as a tongue poking out. Removed; the filled cartoon lips carry the
  smile on their own.

## [0.6.3] - 2026-11-19

### Fixed

- **Tongue in the open (delighted) mouth:** a small soft dome now peeks from behind the lower lip at the
  center — before, it was nearly as wide as the mouth and read as poking out of the sides.

## [0.6.2] - 2026-11-19

### Changed

- **Hands, engaging pose:** the hands sit further to the sides and open outward at 45 degrees — a welcoming
  "ta-da" instead of facing straight up. Clap and cover bring them back upright to meet in front,
  and drooping sinks them visibly down.

## [0.6.1] - 2026-11-19

### Changed

- **Hands, new look and place:** kid-friendly mitten hands — a chubby round palm with three stubby fingers,
  a thumb and a squishy highlight, colored like the character's skin. They now sit to the sides of the eyes at
  about eye height (before: below the mouth), wave more visibly, and pull toward the middle to clap or cover.

## [0.6.0] - 2026-11-19

### Added

- **Hands** — optional cartoon hands below the eyes (off by default; turn on in **Look → Hands** or the tray's
  **Hands** menu). They wave while sleeping, clap when happy, cover the mouth when surprised, point at happy
  messages, and droop when bored, with a gentle idle sway.

## [0.5.3] - 2026-11-18

### Changed

- **Cartoon mouth:** filled Pixar-soft lips with highlight, distinct shapes per mood, and a subtle alive wobble.

## [0.5.2] - 2026-11-18

### Changed

- **Happy Messages:** gap options 3, 5, 10, 20 s and 1 min; shown-for options 5, 10, 20, 30 s.

## [0.5.1] - 2026-11-18

### Changed

- **Happy Messages:** stronger, more vivid colors that change each time; much larger text with a dark outline that fills more of the screen; gentle floating movement; true 8-second display time (fixed timing); long messages wrap into multiple lines; also available in the tray menu.

## [0.5.0] - 2026-11-18

### Added

- **Happy Messages** — when the eyes are sleeping or bored (nobody nearby), a happy, motivational message appears
  in very large text. It shows at the top, center or bottom of the screen, in different sizes and soft colors (gray,
  warm gray, bright). The eyes glance at it. Shown in both normal idle and blur / screen saver modes. On by default;
  configure in **Settings → Happy Messages** (show every 3–60 s, stay 1–15 s) and in the tray menu.
- **After the Eyes** (when the eyes replace the screen saver): after a wait you choose, Big Eyes starts the real
  screen saver or locks the screen, so the computer is protected while you are away. The wait counts from the screen
  saver time: right away, 1, 5, 10, 15, 30 minutes, 1 hour, or any number of minutes in Settings. Default: start the
  screen saver after 5 minutes. Like the system screen saver, it waits while a call or video keeps the display awake.
  Works on macOS, Windows and Linux.

### Removed

- The old **Text** captions ("Welcome" / "Bored" under the eyes) are removed. Happy Messages replace them.

### Fixed

- The macOS install steps in the README: "right-click → Open" no longer works on macOS 15 and later. The steps now
  use **Open Anyway** in System Settings.

## [0.4.1] - 2026-11-08

### Changed

- Project history and metadata clean-up. No change to how the app works.

## [0.4.0] - 2026-11-06

### Changed

- **Several cameras now work as equals.** Each camera has its own calibration, eye contact, smile and timers. The
  first camera that sees you look at the eyes (or smile while looking) counts, for happy, smiling back,
  look-to-close and "wait while I'm looking". Times on different cameras never add up.
- **Calibration is camera by camera** ("camera 1 of 2: …"), saved per camera and kept when you change cameras.
  Settings and the menu show each camera's calibration and can calibrate or forget one camera.

## [0.3.4] - 2026-11-05

### Fixed

- **The eyes could open while you were typing.** Big Eyes counted only the first key of a typing run as input, so
  after about 15-20 seconds of steady typing it thought you were idle. Typing while a hand rested on the mouse
  could also be mistaken for mouse jitter.
  - macOS: a tiny helper now reads separate counters for keys, clicks, scrolling and mouse moves. Keys, clicks and
    scrolling always count; only mouse movement goes through the jitter filter.
  - Windows and Linux: input always counts, except single small wobbles of the mouse after a quiet moment.

## [0.3.3] - 2026-11-04

### Fixed

- With more than one screen, the blur (when the eyes replace the screen saver) now covers **all** screens. The eyes
  stay on the screens chosen in **Screens**; every other screen gets the blur only.

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
