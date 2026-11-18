# Cartoon Mouth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin-lip closed mouth with a Pixar-soft cartoon mouth: filled upper+lower lips with highlight, depth when open, mood-distinct shapes, and subtle alive micro-animation.

**Architecture:** Upgrade `drawMouth()` in `src/renderer/draw.ts` from stroked outline to filled lip shapes. Keep `src/core/animator.ts` MOOD_SHAPES and spring logic as-is; add a small `mouthAlive` drift (sine-based idle wobble) exposed via `EyePose`. No new dependencies.

**Tech Stack:** TypeScript, Electron, Canvas 2D, existing springs + SeededRandom.

**Spec:** `docs/superpowers/specs/2026-11-18-cartoon-mouth-design.md` (phase 1 of 2; hands are phase 2).

## Global Constraints

- Canvas 2D only, no SVG/WebGL.
- Must work at eyeSize 0.35× to 1.7× and dark backgrounds; mouth stays below eyeBounds.
- Keep lip `mouthColor` theming and `showMouth` toggle.
- Keep draw order: eyes → brows → mouth → caption/inspiration/sleep.
- Must pass `npm run typecheck && npm test`.

## Review Focus

- Surprised round-O still reads at small sizes (mouthOpen 0.75, smile 0).
- Bored downturn doesn't look like a smile at 1.0× eyeSize.
- Closed mouth thickness doesn't double-count when mouthOpacity < 1.
- Alive wobble doesn't move cavity/teeth out of lip bounds.
- `showMouth: false` hides mouth fully including highlight and dimple strokes.

---
## File Structure

```
src/renderer/draw.ts        — replace drawMouth, add lip fill + highlight helpers
src/core/animator.ts        — add mouthAlive phase to springs, expose in EyePose
src/renderer/snapshot.ts    — no change; visual check only
```

---

### Task 1: Fill lip shapes + highlight in drawMouth

**Files:**
- Modify: `src/renderer/draw.ts:153-285`

**Interfaces:**
- Consumes: `EyePose { mouthSmile, mouthOpen, mouthWidth, mouthOpacity, time? }`, `EyeLayout`, `LookSettings.mouthColor`
- Produces: `drawMouth(ctx,l,pose,color)` draws filled upper+lower lips with highlight; `mouthPlace` unchanged

- [ ] **Step 1: Add failing visual test — closed mouth has non-zero fill area**

```ts
// test/draw-mouth.test.ts
import { drawMouth } from '../src/renderer/draw';
test('closed curious mouth draws filled lips, not just a stroke', () => {
  // Render to a small offscreen canvas (or mock ctx fill calls)
  // Assert fill was called at least twice (upper + lower lip)
  expect(fillCalls.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/draw-mouth.test.ts`
Expected: FAIL — "fill not called" or file missing

- [ ] **Step 3: Implement filled-lip drawMouth in `src/renderer/draw.ts`**

Derive upper/lower lip filled paths from existing Bezier (upperPath + midLower). Closed (`mouthOpen < 0.08`): fill upper lip (shade lip color -0.15 upper, lip color lower body), fill lower lip (lip color), add lower-lip elliptical highlight (white 22% opacity, w 0.6×mouth width, h 0.15×scaleY). Stroke outer edges at 0.6×current thickness. Open: fill cavity dark, clip teeth+tongue inside, then filled lips around it. Oval-O keeps blend but with outer fill. Preserve `mouthOpacity` alpha.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test test/draw-mouth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/draw.ts test/draw-mouth.test.ts
git commit -m "fix: fill cartoon lips with highlight in drawMouth"
```

---

### Task 2: Distinct mood mouth shapes

**Files:**
- Modify: `src/renderer/draw.ts:drawMouth` (same file, second pass)
- Test: `test/animator.test.ts` or `test/draw-mouth.test.ts`

**Interfaces:**
- Consumes: MOOD_SHAPES[mood].mouth { smile, open, width }
- Produces: visually distinct mouth per mood (sleeping soft-part, surprised O, curious gentle, happy wide, delighted big open, bored downturn)

- [ ] **Step 1: Write failing tests for mood distinctness**

```ts
test('surprised mouth uses oval when smile ~0 and open > 0.3', () => { /* assert ellipse path used */ });
test('bored mouth smile is negative and draws downward smile', () => {
  expect(MOOD_SHAPES.bored.mouth.smile).toBeLessThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test test/draw-mouth.test.ts`
Expected: FAIL with oval detection

- [ ] **Step 3: Adjust drawMouth branching for mood shapes**

Reuse existing `oval` blend (open > 0.3 && |smile|/0.35 < 0.5) with filled-lip upgrade. Bored: smile -0.35 bends corners down — verify lower lip fill still reads downward. Delighted: open 0.55×(1+talking wobble) already provides size; keep. No MOOD_SHAPES value change unless visual review demands.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -5`
Expected: 18+ tests pass

- [ ] **Step 5: Commit**

```bash
git add src/renderer/draw.ts test/draw-mouth.test.ts
git commit -m "fix: distinct mood mouth shapes for cartoon lips"
```

---

### Task 3: Alive micro-animation

**Files:**
- Modify: `src/core/animator.ts` — add `mouthAlive: number` to EyePose, compute via `sin(time*1.1+phase)*0.03` scaled by mood (sleeping 0.02, others 0.015)
- Modify: `src/renderer/draw.ts:drawMouth` — apply `pose.mouthAlive` as ±offset to cornerY/midUpper/midLower (small vertical wiggle) and mouthWidth jitter
- Test: `test/animator.test.ts`

**Interfaces:**
- Consumes: `EyePose.mouthAlive: number`, `time: number`, `phase: number`
- Produces: mouth position wobbles ±1-2 px at 1.1 Hz, invisible in snapshots (time fixed) but visible in animation

- [ ] **Step 1: Write failing test for alive drift**

```ts
test('mouthAlive varies with time', () => {
  const a = new EyeAnimator(settings, 11, 0);
  const p1 = a.update(0);
  const p2 = a.update(0.5);
  expect(p1.mouthAlive).not.toBe(p2.mouthAlive);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test test/animator.test.ts`
Expected: FAIL — property undefined

- [ ] **Step 3: Implement `mouthAlive` in EyeAnimator and apply in drawMouth**

In `EyeAnimator.update()`: `const mouthAlive = Math.sin(now*1.1+phase)*0.015 + Math.sin(now*0.53+phase*1.3)*0.008`; store in pose. In drawMouth: `cornerY += pose.mouthAlive * scaleY * 0.5` and `w *= 1 + pose.mouthAlive * 0.1`. Keep within clip bounds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test 2>&1 | tail -5`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/animator.ts src/renderer/draw.ts test/animator.test.ts
git commit -m "feat: add mouth alive micro-animation"
```

---

### Task 4: Verification and release

**Files:**
- Modify: none (verify only)
- Test: `npm run typecheck && npm test && npm run build`

- [ ] **Step 1: Run full checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: all pass, no unused vars

- [ ] **Step 2: Manual preview — Settings mood buttons each show distinct filled mouth**

- [ ] **Step 3: Bump version, update CHANGELOG, install to /Applications**

Run: `npm version patch --no-git-tag-version && npm run build && ./install.sh --from-source`

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "Release X.Y.Z: cartoon mouth with filled lips and alive animation" && git push origin main
```
