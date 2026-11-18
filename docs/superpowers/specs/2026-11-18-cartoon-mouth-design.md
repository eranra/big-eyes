# Cartoon Mouth Redesign — design

Date: 2026-11-18
Phase: 1 of 2 (hands follow as phase 2)

## Intent

Replace the current thin-lip mouth with a Pixar-soft cartoon mouth: full, bouncy, and expressive. Each mood gets a distinct, readable mouth shape that matches the eyes' energy. The mouth is drawn under the eyes, same position, same lip-color setting.

## Why

The current closed mouth is a single thin stroke — it reads as a line, not lips. An open delighted mouth is better but still flat. For a character that stares, smiles, and gets bored, the mouth is the emotion anchor and should feel as alive as the eyes.

## Goals

- Closed mouth has volume: upper + lower lip are filled shapes with a highlight on the lower lip.
- Open mouth has depth: inner shadow, upper teeth band, tongue, all inside full lip shapes.
- Each MOOD_SHAPES target maps to a clearly different mouth: sleeping (soft part), surprised (round O), curious (small gentle smile), happy (wide smile), delighted (big open grin with teeth+tongue bounce), bored (downturned, slightly pouty).
- Springs animate smile/open/width smoothly; surprised/delighted get a "pop" or "talking wobble" as today.
- Lip color, showMouth toggle, and Settings preview continue to work.

## Non-goals

- No hand/arm work (phase 2).
- No new mouth settings (lip thickness etc.) — lip color stays, mouth shapes are preset per mood.
- No audio / speech bubble.

## Anti-goals

- Don't break mood readability: a happy mouth must still read happy at small eye sizes and dark backgrounds.
- Don't cover the eyes: mouth stays below eyeBounds.

## Prior art / current state

`src/renderer/draw.ts:drawMouth` draws two Bezier curves (upper + lower lip) as a stroked outline; closed state is just that outline. `src/core/animator.ts:MOOD_SHAPES` drives mouthSmile/mouthOpen/mouthWidth springs. Tested by snapshots (`snapshot.ts`).

## Constraints

- Canvas 2D only, no SVG/WebGL.
- Must work at 0.35× (very small) to 1.7× (huge) eye sizes.
- Keep draw call order: eyes → brows → mouth → caption/inspiration/sleep.

## Approaches considered

1. **Lip volume with filled shapes (chosen for phase 1).** Upper and lower lip are each a filled path derived from the same Bezier, with highlight/shadow gradients. Closed state draws both lips filled; open state fills the inner mouth between them. Teeth and tongue sit inside. Keeps the existing Bezier math, just upgrades stroke → fill+stroke. Lowest risk, Pixar-soft result.

2. **Emoji sprite mouth.** Swap canvas mouth for pre-drawn emoji-style mouth images per mood. Fast but pixelated at scale, theming breaks, and no spring interpolation.

3. **Parametric SVG mouth.** Define mouth as an SVG path with control points driven by smile/open. Smoother but requires an SVG renderer inside canvas or a second DOM layer — overkill.

Why 1 wins: reuses current geometry, preserves spring animation, theming, and tests; adds only fill + highlight; matches Pixar-soft brief.

## Design (chosen approach)

- **Geometry:** For each frame, compute Bezier control points for upper lip and lower lip from `mouthSmile`, `mouthOpen`, `mouthWidth`, `l.scale`, `l.ry` exactly as today. Derive two filled lip paths: an outer filled shape (lips) and an inner clip (mouth cavity).
- **Closed (`mouthOpen < 0.08`):** Fill upper lip (#lip color, slightly darkened upper), fill lower lip (lip color), add elliptical highlight on lower lip (white @ 22% opacity, stretched horizontally). Stroke outer edges at 0.6× current thickness for definition.
- **Open:** Fill cavity dark (`rgb 58,16,30`), clip, then draw teeth band (white @ smile-dependent opacity, rounded bottom edge) and tongue ellipse (pink) inside cavity. Fill+stroke lips around it as above.
- **Oval "O" (surprised):** Keep current blend-to-ellipse path when `smile ~ 0` and `open > 0.3`; upgrade its stroke to filled-lip style (outer fill + inner dark).
- **Mood mapping unchanged:** Reuse existing MOOD_SHAPES values; only rendering changes.
- **Files:** `src/renderer/draw.ts` (replace drawMouth + add lip helpers), `src/core/animator.ts` (no shape value changes needed unless tuning after visual review), `test/animator.test.ts` + snapshots (visual check, no logic test break).
- **Verification:** `npm run typecheck && npm test && npm run snapshots` + manual preview in Settings for each mood.

## Open to builder

- Exact highlight position/size and stroke thickness within 10% of spec.
- Whether tongue ellipse is clipped strictly to cavity or allowed 1–2 px overshoot for roundness.
