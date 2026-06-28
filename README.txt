OURA CANVAS v1.0 — Pollock-style biometric art
===============================================

Generative oil-painting canvas driven by Oura Ring sleep/readiness data.
Each day produces a unique painting: good days = airy Matisse palette on cream;
bad days = dense Rothko palette on dark bordeaux. Background color is derived
from the mood (palette-based HSL lerp), not fixed.

FILE STRUCTURE
--------------
v1.0/
  server.js                         — Node.js static server (Express)
  oura-canvas/
    index.html                      — Main page (loads p5.js + p5.oil + painter)
    painter.js                      — Painting engine (palettes, metrics, 5-phase renderer)
    data/
      daily-metrics.json            — Preprocessed Oura Ring data (97 days, Jan-Jun 2025)
      preprocess.js                 — Script that generated daily-metrics.json from raw Oura export
  p5.oil-dist/
    p5.oil.js                       — Custom oil-painting brush library (WebGL2)
    p5.oil.js.map                   — Source map

DEPENDENCIES (CDN, loaded in index.html)
----------------------------------------
- p5.js 1.11.3  (from cdn.jsdelivr.net)
- p5.oil.js     (local, from p5.oil-dist/)

HOW TO RUN
----------
1. npm install express  (if not already installed)
2. node server.js
3. Open http://localhost:3456

NAVIGATION
----------
- Left/right arrow keys to switch between days
- Canvas re-renders deterministically per day (date-seeded PRNG)

ARCHITECTURE
------------
painter.js maps 14 Oura metrics to distinct visual parameters:

  Metric              ->  Visual Parameter
  -------------------------------------------
  readiness + sleep + hrv  ->  moodT (palette blend + density)
  avgHeartRate (RHR)       ->  stroke length, stroke weight
  HRV                      ->  length variance
  REM sleep %              ->  curvature / sway
  deep sleep %             ->  color chroma boost
  efficiency               ->  compositional spread
  sleep score              ->  saturation
  latency                  ->  impasto accent count
  restless periods         ->  edge noise layer
  temp deviation           ->  hue shift + background hue
  workout intensity        ->  splatter count
  workout count            ->  splatter count

Background: HSL lerp from Rothko dark bordeaux (H=0, S=0.5, L=0.08) to
Matisse cream (H=40, S=0.35, L=0.92) based on moodT, with temp deviation
shifting the hue.

5 painting phases:
  1. Underpainting (flatLarge brush, broad sweeps)
  2. Mid-layer (filbertLarge/Medium, multi-segment serpentine splines)
  3. Drips & splatters (knifeSmall, Pollock-style drip trails)
  4. Impasto accents (impasto brush, bold short strokes)
  5. Restless noise (conditional edge scatter if restless > 0.6)

Canvas: 980x700 px (5:7 stretcher ratio), WebGL2 mode.
