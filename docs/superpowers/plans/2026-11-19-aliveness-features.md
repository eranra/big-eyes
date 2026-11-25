# Aliveness Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native, chosen by the human partner) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eleven features that make Big Eyes feel alive, lovely, and usable: blink-back, yawn, dream bubbles, cursor watching, wake-up personality, break nudges, Hebrew messages, custom messages, working hours, seasonal sparkle, and system reactions.

**Architecture:** Each feature lands on its own branch (`feature/<name>`), built test-first (TDD), reviewed by a critic subagent until the critic is pleased, then merged via a squashed PR. Core logic lives in `src/core/` (pure, unit-tested); renderer changes in `src/renderer/draw.ts` / `overlay.ts`; wiring in `src/main/` + `src/core/ipc.ts` + preload. Settings additions touch the Settings interface, defaults, normalization, settings window, and (where useful) the tray menu.

**Tech Stack:** TypeScript, vitest (node env, mock canvas), Electron IPC, Canvas 2D.

**Spec:** The approved feature list from the conversation (below, one section per feature).

**Process per feature (mandatory):**
1. Branch from `main`.
2. Write failing tests; watch them fail.
3. Implement; watch tests pass; full suite + typecheck green.
4. Commit.
5. Dispatch the critic persona (fresh subagent). Fix findings test-first until the critic returns PLEASED.
6. Push, `gh pr create`, `gh pr merge --squash --delete-branch`.
7. Update local `main`; add the CHANGELOG entry under Unreleased.

**Final release:** bump to 0.7.0, CHANGELOG release section, tag `v0.7.0`, GitHub release, install locally via `./install.sh --from-source`.

---

## Feature specs

### F1. Blink back
The eyes blink when the person blinks. `FaceObservation.blink` (0..1, max of MediaPipe `eyeBlinkLeft/Right`); `PersonState.personBlink`; animator mirrors a blink (`blinks.trigger`) when the person's blink > 0.45, they are present, the mood is not sleeping, and ≥ 0.7 s passed since the last mirror. Tests: mirrored blink raises `pose.upperLid` within 0.3 s; no mirror while sleeping; no spam while eyes stay closed.

### F2. Yawn before sleeping
On the mood change to `sleeping` (from any other mood), a 1.6 s yawn: mouth opens (envelope peaking ~0.85), lids droop toward 0.55, tiny scale rise; then sleep proceeds normally. Tests: mouthOpen peaks > 0.35 inside the yawn window and returns to the sleeping value after; no yawn without the mood change.

### F3. Dream bubbles
While sleeping, a small star or heart occasionally floats up from beside the eyes: every 5–9 s, each living 3.2 s, none while awake. `DreamScheduler` (core) + `drawDreams` (renderer), `EyePose.dream`. Tests: scheduler spawns only while sleeping, spaced ≥ 5 s, resets on wake.

### F4. Wake-up personality
When a person appears after an absence ≥ 300 s, a 2.2 s welcome: smile ≥ 0.7, raised brows, a bounce — even without eye contact. Normal short returns behave as today. Tests: after a 6-min absence the pose smiles within 1 s of the face appearing (face looking away); after 20 s it does not.

### F5. Eyes watch the cursor
Main sends the normalized cursor position (per display, ≤ 10 Hz) to overlays while the eyes are shown and the pointer moves. When nobody is present (and not sleeping), the eyes glance toward the cursor every 2.5–4 s for ~0.9 s. `CursorGlancer` (core, pure) + IPC channel `cursor`. Tests: glances only when absent, spaced ≥ 2 s, direction follows the cursor; presence suppresses.

### F6. Break nudges
After `breakReminderMinutes` (default 45; 0 = off) of continuous presence, one nudge per stretch: the existing inspiration rendering shows "Time to stretch?" centered for ~6 s, hands point, eyes glance. The timer resets after ≥ 20 s of absence. Settings + menu presets (Off / 15 / 30 / 45 / 60 / 90). Tests: fires at the set time, not before; resets on absence; off at 0; animator surfaces the nudge.

### F7. Hebrew messages + RTL
`messageLanguage: 'en' | 'he'` (default en). A full Hebrew message list; `ctx.direction = 'rtl'` for Hebrew drawing (centered, wrapped as today). Tests: list selection per language; RTL flag on active messages; settings validation.

### F8. Custom messages
`customMessages: string[]` (default empty). Validated: trimmed, non-empty, ≤ 100 entries, ≤ 80 chars each. When present they extend the built-in list (deduped). Settings textarea, one per line. Tests: sanitization; scheduler draws from the combined list; empty custom behaves as today.

### F9. Working hours
`scheduleEnabled` (default false), `scheduleStart` / `scheduleEnd` ('HH:MM'). Outside the window the eyes are blocked with reason "outside working hours"; overnight windows (start > end) supported; inclusive boundaries. Settings UI + menu checkbox. Tests: `withinSchedule` normal/overnight/boundaries/disabled.

### F10. Seasonal sparkle
`seasonFor(date)`: December → snow, September–November → leaves, February 14 → hearts, else null. `drawSeason` renders 14 deterministic, subtle particles (falling snow/leaves, rising hearts) behind the eyes while they are shown. Tests: season boundaries; drawing smoke test.

### F11. System reactions
Best-effort platform probes in `system.ts` (graceful no-op on failure) driving three animator reactions over a new IPC channel:
- **Charging → relieved** (macOS `pmset -g batt`, Linux `/sys/class/power_supply`, Windows `Win32_Battery`): a 2.5 s soft smile with a little exhale on the battery→AC transition.
- **Screenshot → squint** (watch the macOS screenshot folder from `defaults read com.apple.screencapture location`, Windows `Pictures\Screenshots`): a 1.2 s squint when a new screenshot appears.
- **Music → gentle bob** (macOS no-idle-sleep assertions, Windows `powercfg /requests` audio): while audio plays the eyes bob softly.

Tests: the pure parsers (fixture strings); the animator reactions (relieved raises smile, squint raises the lid briefly, music oscillates scale); probe failures default to off.

---

## Review Focus (critic checks per feature)

- Tests fail without the feature (the critic reverts the implementation mentally / checks assertions are real).
- Deterministic simulation — no real-time sleeps in tests.
- Settings round-trip: defaults, validation, merge, UI binding.
- No regressions in the 220+-test suite; typecheck clean.
- Behavior is subtle and never blocks or hides the eyes unexpectedly.
