# Bottom Hands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pair of animated bottom-edge hands (waving, clapping, covering, pointing) with a Settings/mnu toggle.

**Architecture:** New `src/core/hand.ts` (gesture logic + pose), `EyePose.hands` field, `drawHands()` in `src/renderer/draw.ts` (two palms+fingers), Settings/persist + preview + menu.

**Tech Stack:** TypeScript, Canvas 2D, springs, Jest/vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-bottom-hands-design.md`

## Global Constraints

- Canvas 2D only; no images/SVG.
- Must work at eyeSize 0.35×–1.7× and all screen positions.
- `showHands: false` hides completely.
- Draw after mouth, before inspirations.
- `npm run typecheck && npm test && npm run build` must pass.

## Review Focus

- Hands never obscure eyeBounds (mouth y+offset, verify via eyeBounds check).
- Delighted clap alternate frames don't flicker at 60 fps (smoothstep).
- Pointing gesture aims at message wrap-center, not screen center.
- Sleeping wave doesn't move when inspirations hidden but hands shown.
- Toggle persists across restart and respects showHands toggle quickly (<100 ms).

---

### Task 1: Hand logic — `src/core/hand.ts`

**Files:**
- Create: `src/core/hand.ts`
- Test: `test/hand.test.ts`

**Interfaces:**
- Consumes: `Mood`, `ActiveInspiration | null`
- Produces: `export type HandGesture = 'rest'|'wave'|'clap'|'cover'|'point'|'droop'`; `export interface HandPose { gesture: HandGesture; lift: number; spread: number; rotation: number; opacity: number; yJitter: number }`; `export class HandScheduler { pose: HandPose; update(now: number, mood: Mood, inspiration: ActiveInspiration|null, showHands: boolean): HandPose }` — wave: `sin(now*1.4)` lift, clap: `abs(sin(now*3.5))` spread, point: fixed lift+rotation, cover: lift toward mouth, droop: negative lift.

- [ ] **Step 1: Write failing test for hand logic**

```ts
import { HandScheduler } from '../src/core/hand';
import { defaultSettings } from '../src/core/settings';
test('sleeping waves', () => {
  const h = new HandScheduler(defaultSettings().hand, 1);
  const p = h.update(0, 'sleeping', null, true);
  expect(p.gesture).toBe('wave');
});
test('hidden when showHands false', () => {
  const h = new HandScheduler(defaultSettings().hand, 1);
  expect(h.update(0, 'happy', null, false).opacity).toBe(0);
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `npm test test/hand.test.ts -v`
Expected: FAIL cannot find module

- [ ] **Step 3: Implement `src/core/hand.ts`**

Define MOOD_GESTURE map: sleeping→wave, surprised→cover, curious→rest, happy→clap, delighted→clap, bored→droop. If inspiration present, override to `point`. Smooth lift/spread/rotation via springs or lerp. Expose `defaultHandSettings(): HandSettings { showHands:false }` (off by default, user opts in).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test test/hand.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/hand.ts test/hand.test.ts
git commit -m "feat(hand): add HandScheduler with mood gestures"
```

---

### Task 2: Settings + EyePose wiring

**Files:**
- Modify: `src/core/settings.ts` — add `showHands: boolean`, default false, persist
- Modify: `src/core/animator.ts` — add `handPose` to EyePose, update via HandScheduler each frame

**Interfaces:**
- Consumes: `HandScheduler`, `HandSettings`
- Produces: `EyePose.handPose: HandPose` available to renderer

- [ ] **Step 1: Write failing test — settings round-trip**

```ts
import { normalizeSettings, defaultSettings } from '../src/core/settings';
test('showHands persists', () => {
  const s = normalizeSettings({ ...defaultSettings(), showHands: true });
  expect(s.showHands).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL (property missing)**

Run: `npm test test/settings.test.ts -v`
Expected: FAIL showHands undefined

- [ ] **Step 3: Implement settings field + animator wiring**

Add to Settings interface, defaultSettings, normalizeSettings (bool fallback false), mergeSettings. In EyeAnimator: `hands: HandScheduler`, `pose.handPose`, `apply` updates settings. In `update()`: `pose.handPose = this.hands.update(now, mood, inspiration, settings.showHands)`.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -v 2>&1 | tail -20`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/core/settings.ts src/core/animator.ts test/settings.test.ts test/animator.test.ts
git commit -m "feat: wire hand settings and EyePose.handPose"
```

---

### Task 3: Canvas hands — `src/renderer/draw.ts`

**Files:**
- Modify: `src/renderer/draw.ts` — add `drawHands(ctx,l,pose)` and `handPlace(l)` helper

**Interfaces:**
- Consumes: `HandPose`, `EyePose.handPose`, `EyeLayout`, mouthColor
- Produces: Two palms (left/right) below mouth, fingers as rounded rects, gesture morphing

- [ ] **Step 1: Write failing test — draw calls present**

```ts
import * as drawSrc from '../src/renderer/draw';
test('drawHands exported', () => {
  expect(typeof drawSrc.drawHands).toBe('function');
});
```

- [ ] **Step 2: Run — FAIL (not exported)**

Run: `npm test test/draw-hands.test.ts -v`
Expected: FAIL drawHands undefined

- [ ] **Step 3: Implement drawHands**

`handPlace(l)` → y = `mouthPlace(l).y + l.ry*1.2`, x = `l.cx ± l.spacing*0.55`. Each hand: palm ellipse (shade skin from mouthColor muted), 4 finger capsules (rect+arc), thumb offset. Gestures: wave changes rotation±18°, clap toggles finger spread via `abs(sin)`, cover lifts Y, point rotates index finger up, droop rotates -25°. Respect `pose.opacity` and `showHands`.

- [ ] **Step 4: Run tests — PASS**

Run: `npm test -v 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/draw.ts
git commit -m "feat: draw cartoon hands at bottom edge"
```

---

### Task 4: Settings UI + menu + verification

**Files:**
- Modify: `src/renderer/settings.html` — Hands toggle
- Modify: `src/renderer/settings.ts` — bind toggle to `api.updateSettings({ showHands })`, preview refresh
- Modify: `src/main/menu-model.ts` — Hands submenu (Show Hands checkbox + gesture hint)
- Modify: `docs/architecture.md` — mention hands

**Interfaces:**
- Consumes: `Settings.showHands`
- Produces: Toggle visible in Settings and tray; persisted; manual preview per mood

- [ ] **Step 1: Add UI and verify settings round-trip via menu**

```ts
import { buildMenuModel } from '../src/main/menu-model';
test('menu shows hands toggle', () => {
  const m = buildMenuModel({ ...defaultSettings(), showHands: true } as any, [], [], 'darwin');
  expect(JSON.stringify(m)).toContain('Hands');
});
```

- [ ] **Step 2: Run — FAIL (Hands missing)**

Run: `npm test test/menu-model.test.ts -v`
Expected: FAIL

- [ ] **Step 3: Implement menu + Settings UI**

Add `handsMenu(settings)` similar to themeMenu, integrate in buildMenuModel. Settings HTML: checkbox row `#showHands`; settings.ts binds change.

- [ ] **Step 4: Run full suite — PASS, then build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS

- [ ] **Step 5: Version bump, changelog, install, push**

```bash
npm version minor --no-git-tag-version && npm run build && ./install.sh --from-source
git add -A && git commit -m "Release 0.6.0: bottom hands with mood gestures" && git push origin main
```
