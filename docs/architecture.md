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
| happy | eye contact for 0.45 s (kept 0.7 s after it ends) | crescent "smiling" eyes, cheeks, "Welcome" |
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
