# Architecture

Big Eyes has three parts. Only the core is shared by all of them, and the core has no Electron or browser code,
so it is tested with plain unit tests.

```
src/
  core/        Pure TypeScript logic, unit tested. No Electron, no DOM.
    math.ts        vectors, smoothing, seeded random numbers
    spring.ts      damped springs (all motion)
    face.ts        MediaPipe result -> FaceObservation (head yaw/pitch, eye direction, smile)
    attention.ts   FaceObservation[] -> PersonState (where you are, eye contact yes/no)
    mood.ts        PersonState over time -> Mood (sleeping, surprised, curious, happy, bored)
    blink.ts       natural blink timing
    animator.ts    Mood + PersonState -> EyePose for every frame
    idle.ts        system idle time -> show / hide
    settings.ts    settings type, defaults, themes, validation, screen selection
    camera.ts      which camera to open (saved id, saved name, built-in camera)
    ipc.ts         IPC channel names and message types
  main/        Electron main process
    main.ts        tray, overlay windows, idle loop, permissions, app:// protocol
    menu-model.ts  tray menu as plain data (unit tested), converted to an Electron Menu
    store.ts       settings.json load / validate / atomic save
    system.ts      macOS video playback check, Linux autostart
  preload/     the only bridge between pages and the main process (window.bigEyes)
  renderer/    pages
    overlay.*      the eyes, one transparent window per screen
    tracker.ts     camera + MediaPipe Face Landmarker
    draw.ts        canvas drawing of an EyePose
    settings.*     settings window with a live preview
    snapshot.*     renders still images for the docs
```

## Data flow

```
camera ──> MediaPipe Face Landmarker ──> faceFromLandmarks() ──> FaceObservation[]
                                                                     │
          (tracker overlay only; faces are forwarded to the other overlays by the main process)
                                                                     ▼
                     AttentionEstimator ──> PersonState ──> MoodMachine ──> Mood
                                                   │                          │
                                                   └──────> EyeAnimator <─────┘
                                                                │  springs, saccades, blinks
                                                                ▼
                                                            EyePose ──> drawEyes() ──> canvas
```

Only one overlay window (the one on the main screen, when it is selected) opens the camera.
It sends the faces to the main process, which forwards them to the overlays on the other screens.
Each overlay runs its own animator, so all screens show the same behavior.

## Idle time and mouse jitter

`ActivityClock` (`src/core/activity.ts`) keeps Big Eyes' own idle time. The system idle counter resets on any input
event, including 1-3 pixel wobbles from some wireless mice. The clock samples the pointer 10 times per second:
more than 8 pixels of travel within 2 seconds is mouse use; a system reset without any pointer movement is a key
press or click; anything else is jitter and is ignored.

## Waiting while someone looks at the screen

`PresenceCheck` (`src/core/presence.ts`). When the idle time is reached and `waitWhileWatched` is on, the main
process does not show the eyes at once. It asks the tracker overlay (hidden, but loaded) to open the cameras for
3 seconds of frames, after a 1-second warm-up (first frames are often dark), with a 15-second limit if the camera
never answers.

"Looking at the screen" is decided by **the same process as eye contact and look-to-close**: each check feeds the
frames into a fresh `AttentionEstimator` with the user's settings and calibration. Only `isMakingEyeContact`
counts. So looking at a phone, a book or another screen does not hold the eyes back.

- Someone looks at the screen: wait and check again after 15 seconds.
- Nobody looks (or nobody is there, or the camera fails): show the eyes.
- After the eyes were dismissed (key, click, mouse onto the eyes, look-to-close), no checks run until new input
  (`IdleMonitor.canShow`).

## Screen saver

- `pause` (default): while `ScreenSaverEngine` / `legacyScreenSaver` (macOS) or a `.scr` process (Windows) runs,
  showing is blocked, and the eyes close if they were open.
- `replace`: `powerSaveBlocker.start('prevent-display-sleep')` keeps the screen saver and display sleep away while
  Big Eyes runs. The "don't show during video" check ignores this blocker, because it is our own.
- Blur in `replace` mode starts when the idle time reaches the screen saver time (`screenSaverSeconds()`): the
  user's own time, else the system time from `systemScreenSaverTime()` (`src/main/system.ts`), else 10 minutes.

  | System | Sources, first found wins |
  |---|---|
  | macOS | `/Library/Managed Preferences/<user>/com.apple.screensaver.plist` and `/Library/Managed Preferences/com.apple.screensaver.plist` (`idleTime`, set by IT profiles), `defaults -currentHost read com.apple.screensaver idleTime`, `pmset -g` displaysleep |
  | Windows | `HKCU\Software\Policies\Microsoft\Windows\Control Panel\Desktop`, `HKCU\Control Panel\Desktop` (`ScreenSaveActive`, `ScreenSaveTimeOut`), `powercfg /q` monitor-off |
  | Linux | `gsettings get org.gnome.desktop.session idle-delay`, `~/.config/kscreenlockerrc` `Timeout` |

  It is read at start, and again on screen unlock, wake, and (macOS) file changes in those folders. There is no timer. The main process decides it on every idle
  tick and switches the window blur (macOS vibrancy, Windows acrylic) and the page tint.

## Updates

`src/core/update.ts` decides the update path; `src/main/updater.ts` runs it. Releases on GitHub include
electron-builder's `latest*.yml` files, and the app contains `app-update.yml` (written at packaging time).

| System | How |
|---|---|
| Windows (NSIS), Linux AppImage | `electron-updater` downloads in the background, then "Restart Now" installs it |
| macOS | Reads `releases/latest/download/latest-mac.yml`; shows the release link and the install command. (Squirrel.Mac needs a Developer ID signature, which ad-hoc builds do not have.) |
| Linux .deb | Reads `latest-linux.yml`; shows the release link |
| `npm start` | No checks |

Automatic checks run 10 seconds after start and every 6 hours, and announce each version once
(`lastAnnouncedVersion`). **Check for Updates…** always shows the result.

## Several cameras

The tracker opens every chosen camera, each with its own MediaPipe landmarker, and processes them in turn
(about 20 detections per second in total). Every face carries the index of its camera; 0 is the main camera.

`AttentionEstimator.ingest()` uses the main camera for position and eye contact, because only the camera next to
the eyes can tell whether you look *at the eyes*. When the main camera sees nobody, a face on another camera keeps
the person present, the eyes keep their last position, and eye contact fades. Smiles count from any camera.

## Smiles

MediaPipe's `mouthSmileLeft` / `mouthSmileRight` blendshapes give a smile score. It is smoothed, and the decision
uses two thresholds (on at 0.45, off at 0.25). `MoodMachine` enters **delighted** when the person smiles for
`smileToDelighted` seconds while making eye contact (or while the eyes are already happy), and leaves it
`delightedHold` seconds after the smile ends. The mouth springs follow the mood; when delighted the mouth also
opens with how much the person smiles.

## How eye contact is decided

For each face, MediaPipe gives:

- a 4×4 face transformation matrix. `headAnglesFromMatrix()` turns it into head **yaw** and **pitch**.
- 52 blendshape scores. `gazeFromBlendshapes()` combines `eyeLook{In,Out,Up,Down}{Left,Right}` into one **eye direction**.

`AttentionEstimator.rawContactScore()` compares these three values with a **reference** (the values recorded by
"Calibrate", or measured defaults). Each difference is divided by its tolerance and the results are combined
into one distance. Distance below about 0.75 gives score 1, above about 1.35 gives score 0, with a smooth curve
between. The score is smoothed over time, and the yes/no decision uses two thresholds (on at 0.62, off at 0.38),
so it does not flicker.

The camera sits above the screen, so a person who looks at the screen looks a little *down* from the camera's
point of view. With a MacBook Pro camera we measured pitch about +10° and eye direction y about +0.2 for
"looking at the screen". These are the defaults. Calibration replaces them with your own values.

## Moods

| Mood | Enter when | Look |
|---|---|---|
| sleeping | nobody seen for 8 s | lids closed, slow breathing, `z z z` |
| surprised | a person appears after sleep, or after 2 s of nobody | wide open, small pupils, raised brows, a "pop" |
| curious | a person is there, no eye contact yet | follows the person, small eye jumps |
| happy | eye contact for 0.45 s (kept 0.7 s after it ends) | crescent "smiling" eyes, cheeks, gentle smile |
| delighted | the person smiles at the eyes for 0.3 s | big crescent eyes, open smile with teeth, bounce |
| bored | no eye contact for 2.5 s | heavy tilted lids, low brows, looks away, "Bored" |

All times are settings (`mood.*` in `settings.json`).

## Why the eyes feel alive

- Every value moves with a damped spring (`spring.ts`), never in straight lines.
- Gaze uses a fast spring, so moves look like saccades. Between moves there are micro-saccades and a small tremor.
- Blinks come every 1.8–5.5 s, close in 75 ms and open in 150 ms, with 15 % double blinks. Mood changes add blinks.
- The pair breathes (scale) and floats (position) on slow sine waves with random phases.
- The highlights move less than the iris, like a reflection of a fixed light.

## Overlay windows

Each overlay is a frameless, transparent, always-on-top (`screen-saver` level) window that covers one display,
shows on all workspaces and over full-screen apps, ignores the mouse (clicks go through), and never takes focus.
The idle loop in the main process runs 10 times per second. It reads `powerMonitor.getSystemIdleTime()` and the
pointer position. Each overlay page reports the box around its eyes (10 times per second, because the eyes drift).

- No input for `idleTimeout` seconds (default 30): show.
- The idle time resets while the pointer did not move, so the input was a key press or a click: hide.
- Pointer movement, depending on `mouseRule`:
  - `onto-eyes` (default): moving into the eye box (plus a 24 px margin) hides; moving elsewhere is fine;
  - `any`: any movement hides;
  - `never`: movement is ignored.
- Look-to-close (`lookToClose`, off by default): `EyeAnimator` counts how long eye contact lasts.
  After `lookToCloseSeconds` it winks and sets `wantsToClose`; the overlay asks the main process to hide.
  A ring around the eyes shows the progress. It is paused during calibration.

The rules are in `src/core/idle.ts` and are unit tested.

## Security

- Pages run with `contextIsolation`, `sandbox`, and no Node access. They use only the small API in `preload.ts`.
- Pages are served from a custom `app://bundle/` protocol that only serves files inside the build folder.
- Only camera (video) permission is granted, and only to our own pages. Navigation and new windows are blocked.
- Every settings value from the file or from a page is validated in `normalizeSettings()`.
