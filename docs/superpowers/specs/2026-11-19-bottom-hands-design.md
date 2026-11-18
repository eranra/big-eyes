# Bottom Hands — design

Date: 2026-11-19
Phase: 2 of 2 (mouth was phase 1, shipped as 0.5.3)

## Intent

Add a pair of bottom-edge hands that appear below the eyes as an optional animated character element. They peak from the bottom of the screen, animate per mood/message, and feel Pixar-soft — same warm aesthetic as the cartoon mouth.

## Why

The eyes alone are expressive but disembodied. Hands give the watcher a body without covering the eyes: they wave hello while sleeping/bored, clap when delighted, cover the mouth when surprised, rest during curious, and point at happy messages. This turns idle time into a tiny character performance.

## Goals

- Two hands, soft cartoon style (rounded fingers, skin-tone or theme-matched fill, no detailed joints). Canvas 2D only.
- Appear from bottom edge of the screen (outside eyeBounds), centered horizontally. Never obscure eyes.
- One animated gesture per mood/message, spring-smoothed:
  - sleeping: gentle up/down wave (alternating hands)
  - surprised: both hands covering mouth
  - curious: hands resting at bottom edge (fingers peeking)
  - happy: small clap / open-palm cheer
  - delighted: big clap / bounce
  - bored: one hand drooped over edge, or supporting chin
  - happy message shown: nearest hand points at message
- Toggle in Settings → Appearance (showHands, on by default after first enable) and in tray menu (Hands submenu).
- Spring + sine micro-animation so hands feel alive (same pattern as mouthAlive).
- Preview in Settings shows hands for each mood.

## Non-goals

- Full arms / elbows / shoulders — only hands + short forearm stump.
- User-customizable skin tone (phase 3 if requested).
- Touch interaction (hands are decorative).

## Anti-goals

- Hands must not increase click-through blocking (overlay is click-through; hands are visual only).
- Must not double CPU cost: one extra draw call per frame max.

## Prior art / current state

- `src/renderer/draw.ts:mouthPlace` positions mouth below eyes; `src/core/animator.ts:MOOD_SHAPES` drives mouth per mood. Hands reuse same mood → pose pattern via new HandPose fields.
- EyeBounds `src/renderer/draw.ts:eyeBounds` already defines where eyes+brows+mouth sit; hands render below it.

## Constraints

- Canvas 2D, no images/SVG.
- Works at eyeSize 0.35×–1.7× and any screen size / position preset.
- Must respect `showHands: false` (hide completely, no animation tick).
- Order after mouth so z matches (mouth above hands if overlapped).

## Approaches considered

1. **Canvas hand + forearm drawn from primitives (chosen).** Ellipse palm + 4–5 finger capsules, rounded. One `drawHands(ctx,l,pose)` after mouth. Driven by HandPose `{ mood, messagePointing, alive }` springs. Lowest dependency, matches eye rendering, theme-tintable.

2. **Sprite sheet.** Pre-rendered PNG hands per gesture. Crisp but not scalable, more assets, no spring morph.

3. **Lottie/vector animation file.** Rich motion but extra library, heavier bundle, mood mapping harder.

Why 1 wins: zero assets, scales with screen, blends with cartoon mouth, reuses existing spring infrastructure.

## Design (chosen approach)

- **Data:** `src/core/hand.ts` — `HandPose` type, `handTarget(mood, messagePos, alive)` → pose; `HandSettings { showHands }` in `Settings`. Persisted like mouth. `MOOD_HANDS` map mood→gesture descriptor.
- **Animation:** `src/core/animator.ts` adds `handPose` to `EyePose`, computed from mood + inspirations presence via `HandScheduler` (similar to InspirationScheduler): sine alive + mood-gated target with spring smoothing.
- **Render:** `src/renderer/draw.ts:drawHands` — place below mouth (mouthPlace.y + offset), two side-by-side palms; gesture modifies finger spread, rotation, and Y lift. Uses `mouthColor` muted + skin tint for hands.
- **Wiring:** `src/renderer/overlay.ts` unchanged (reads from EyePose); `src/renderer/settings.ts` adds toggle; `src/main/menu-model.ts` adds Hands submenu.
- **Files:** `src/core/hand.ts` (new), `src/core/settings.ts`, `src/core/animator.ts` (extend EyePose), `src/renderer/draw.ts`, `src/renderer/settings.html/.ts/.css`, `src/main/menu-model.ts`, tests, docs.
- **Verification:** `npm run typecheck && npm test && npm run build` + manual preview per mood.

## Open to builder

- Finger count 4 vs 5, exact palm aspect ratio, and spring stiffness within 20% of spec.
- Whether delighted clap is symmetric single frame or two alternating frames.
