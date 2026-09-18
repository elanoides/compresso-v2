# PROJECT_CONTEXT.md: Kinetic Typography SVG Studio

## 1. Product Vision
Kinetic Typography SVG Studio — lightweight browser-based kinetic typography and SVG motion engine following the "Preset-First + Vector Precision" approach.
Enables designers and developers to turn text or SVG brand marks into motion design in seconds (inspired by DIA Studio and DEMO Festival).

## 2. Tech Stack
- Language: TypeScript (strict mode)
- Base UI: React 18+ / Vite + Tailwind CSS + shadcn/ui
- State: Zustand
- Typography & Fonts: opentype.js (glyph parsing to SVG paths)
- Vector Normalization: svg-path-commander
- Shape Morphing: flubber
- Engine: Hybrid Canvas 2D / SVG under requestAnimationFrame
- Media Export: WebCodecs API + mp4box.js (client-side video rendering)

## 3. Presets Catalog
1. Swiss Kinetic Grid (DIA Style metric loops, synchronized font-stretch & tracking)
2. Cascading Stagger Mask (clip-path letter reveal with spring overshoot)
3. Ribbon & Sine Wave (continuous sinusoidal path deformation)
4. Kinetic Stroke (fill:none, stroke-dashoffset sketch drawing into fill)
5. Variable Pulse (LFO-driven font-variation-settings wght/wdth)
6. Liquid Vector Morph (flubber interpolation between glyphs and shapes)

## 4. AI Rules for Cursor
- Keep physics and easing calculations isolated in pure functions inside `src/core/presets/`.
- Never trigger DOM reflows (getBoundingClientRect) inside the animation loop.
- Use strict TypeScript interfaces without `any`.
