// Symbiotic oil painter driven by Oura Ring metrics
// Composition is a continuous function of body state — no date influence.

// === PALETTES ===
const MATISSE = [
  [230, 57, 70],    // red
  [241, 196, 15],   // yellow
  [6, 174, 213],    // cyan
  [42, 157, 143],   // teal
  [231, 111, 81],   // coral
  [38, 70, 83],     // deep blue
  [244, 162, 97],   // orange
  [102, 155, 188],  // sky blue
  [255, 183, 3],    // golden
];

const ROTHKO = [
  [74, 14, 14],     // deep red
  [107, 39, 55],    // maroon
  [139, 0, 0],      // dark red
  [44, 24, 16],     // dark brown
  [61, 0, 0],       // blood red
  [26, 10, 10],     // near black
  [92, 31, 31],     // wine
  [138, 54, 15],    // burnt sienna dark
  [55, 20, 20],     // dark maroon
];

// === PERSONAL-PERCENTILE NORMALIZATION ===
// Each metric is normalized against the OWNER'S OWN distribution, not against
// hardcoded population constants. A value of 0.9 means "higher than 90% of your
// own days" — good/bad is measured against your own history, not abstract numbers.
// This is what makes the work about THIS body. As the live dataset grows, a given
// day's normalized state drifts with the body's evolving baseline (co-evolution).

// Day-field names whose distribution drives the visual parameters.
const PCT_FIELDS = [
  'readinessScore', 'sleepScore', 'hrv', 'avgHeartRate', 'avgBreath',
  'totalSleepHours', 'deepSleepPct', 'remSleepPct', 'efficiency',
  'latency', 'restlessPeriods',
];

// Build sorted value arrays per metric from the owner's days. Cached on the
// dataset object so it is computed once per load.
function buildPercentiles(days) {
  const dist = {};
  for (const k of PCT_FIELDS) {
    dist[k] = days
      .map(d => d[k])
      .filter(v => v != null && !isNaN(v))
      .sort((a, b) => a - b);
  }
  return dist;
}

// Percentile rank of `v` within a sorted array → fraction in [0,1].
// Empty/missing distribution or value falls back to 0.5 (neutral).
function percentile(sorted, v) {
  if (v == null || isNaN(v) || !sorted || sorted.length === 0) return 0.5;
  if (sorted.length === 1) return 0.5;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= v) lo = m + 1; else hi = m; }
  return lo / sorted.length;
}

function normalizeMetrics(day, dist) {
  dist = dist || {};
  const P = (k) => percentile(dist[k], day[k]);
  return {
    // Core mood drivers
    readiness: P('readinessScore'),
    sleep: P('sleepScore'),
    hrv: P('hrv'),

    // Physical intensity
    rhr: P('avgHeartRate'),       // higher percentile = higher HR = more stressed
    breath: P('avgBreath'),        // higher = more anxious

    // Sleep architecture
    sleepHours: P('totalSleepHours'),
    deepPct: P('deepSleepPct'),
    remPct: P('remSleepPct'),
    efficiency: P('efficiency'),
    latency: P('latency'),         // higher = took long to fall asleep
    restless: P('restlessPeriods'),

    // Temperature & activity
    temp: day.tempDeviation ?? 0,                // -1 to +1, keep as signed
    workoutCount: day.workoutCount || 0,
    workoutIntensity: day.workoutIntensity || 0,

    // Raw for debugging
    _raw: day,
  };
}

// === HSL MODULATION ===
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255),
  ];
}

// Apply mood-based modulation to a color, ensuring contrast with background.
// `jitter` is a deterministic small offset in [0,1), used where the original
// had Math.random(); passing 0 keeps the function purely deterministic.
function modulateColor(rgb, m, moodT, bgL, jitter = 0) {
  let [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);

  // Saturation: sleep score scales saturation (floor at 0.55 so bad days still read)
  s *= (0.55 + 0.45 * m.sleep);

  // Lightness: mood shifts lightness slightly
  l += (moodT - 0.5) * 0.12;

  // Temperature deviation: shift hue warm/cool
  const tempShift = (m.temp || 0) * 25;
  h -= tempShift;

  // Deep sleep boosts contrast: deeper sleep → push lightness away from 0.5
  const contrast = 0.55 + m.deepPct * 0.45;
  l = 0.5 + (l - 0.5) * contrast;

  // Ensure stroke has contrast with background lightness
  if (bgL != null) {
    const delta = l - bgL;
    if (bgL < 0.35 && delta < 0.18) l = bgL + 0.18 + jitter * 0.35;
    else if (bgL > 0.7 && delta > -0.18) l = bgL - 0.18 - jitter * 0.45;
  }

  l = Math.max(0.05, Math.min(0.95, l));
  s = Math.max(0, Math.min(1, s));

  return hslToRgb(h, s, l);
}

// Background color: fixed warm ivory ground (Matisse cream paper)
function backgroundColor(moodT, m) {
  return hslToRgb(42, 0.35, 0.90);
}

// === BODY-ONLY SEED ===
// Hash the day's biometric fields into an integer. Two days with identical
// bodies ⇒ identical seed ⇒ identical painting. Date plays no role.
function hashMetrics(day) {
  const parts = [
    day.readinessScore, day.sleepScore, day.hrv,
    day.avgHeartRate,   day.avgBreath,
    day.totalSleepHours, day.deepSleepPct, day.remSleepPct,
    day.efficiency,     day.latency,      day.restlessPeriods,
    day.tempDeviation,  day.workoutCount, day.workoutIntensity,
  ];
  let h = 0x811c9dc5;
  for (const v of parts) {
    // Quantize to 3 decimals — kills float noise, preserves sensitivity.
    const q = Math.round(((v ?? 0) + 1e-9) * 1000) | 0;
    h = ((h << 5) - h + q) | 0;
    h = Math.imul(h ^ (h >>> 13), 0x85ebca6b);
  }
  return Math.abs(h) || 1;
}

// Mulberry32 PRNG — deterministic, fast, good distribution
function makeRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// === HALTON LOW-DISCREPANCY SEQUENCE ===
// Deterministic quasi-random number in [0, 1) for a given index and base.
// Using (base 2) × (base 3) gives a blue-noise-like 2D point cloud that
// fills space evenly without any periodic structure — the baseline for
// non-lattice point placement. Body continuity is injected downstream via
// a warp field, NOT via the cloud itself (which is identical across days).
function halton(i, base) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

// === CONTINUOUS PALETTE SAMPLING ===
// Any t in [0,1] maps to a color inside the palette via linear interpolation
// between adjacent entries. Two close t values ⇒ two close colors.
function samplePalette(palette, t) {
  t = Math.max(0, Math.min(1, t));
  const p = t * (palette.length - 1);
  const i = Math.floor(p);
  const frac = p - i;
  const a = palette[i];
  const b = palette[Math.min(i + 1, palette.length - 1)];
  return [
    a[0] + (b[0] - a[0]) * frac,
    a[1] + (b[1] - a[1]) * frac,
    a[2] + (b[2] - a[2]) * frac,
  ];
}

// Palette pick as a continuous function of mood and field value at (x, y).
// - moodT shifts the Rothko/Matisse boundary across the canvas (contour).
// - |field| picks position within the palette — extrema get the saturated ends.
function pickColorField(m, moodT, bgL, fv, rng) {
  const useMatisse = (fv * 0.4 + 0.5) < moodT;
  const pool = useMatisse ? MATISSE : ROTHKO;
  const t = Math.abs(fv);
  const base = samplePalette(pool, t);
  return modulateColor(base, m, moodT, bgL, rng ? rng() : 0);
}

// === MAIN PAINTER ===
// `data` is the full dataset { stats, days, meta }. Percentile distributions are
// built from data.days once and cached on the object (data._dist).
function paintDay(p, day, data, W, H) {
  const days = (data && data.days) || [];
  if (data && !data._dist) data._dist = buildPercentiles(days);
  const dist = (data && data._dist) || buildPercentiles(days);

  const m = normalizeMetrics(day, dist);
  const moodT = (m.readiness + m.sleep + m.hrv) / 3;

  // Seed RNG and oil textures from body only — identical body ⇒ identical canvas.
  const seed = hashMetrics(day);
  const rng = makeRNG(seed);
  oil.seed(seed);

  // === FRACTAL FLOW FIELD (3 octaves) ===
  // Base frequency from HRV (X) / sleep (Y). Max ~0.02 → ~3 waves across W=980.
  const freqX = 0.004 + m.hrv  * 0.016;
  const freqY = 0.004 + m.sleep * 0.016;

  // Base phase shifted by mood — moves bright/dark zones across the canvas.
  const phiX  = moodT * Math.PI * 2;
  const phiY  = (1 - moodT) * Math.PI * 2;
  // Octave 2 phase shifted by HRV/sleep — decorrelates from base.
  const phiX2 = m.hrv   * Math.PI * 2;
  const phiY2 = m.sleep * Math.PI * 2;
  // Octave 3 phase shifted by deep/REM — fine detail from sleep architecture.
  const phiX3 = m.deepPct * Math.PI * 2;
  const phiY3 = m.remPct  * Math.PI * 2;

  // Non-integer octave multipliers avoid resonance (no repeating lattice).
  const OCT2 = 2.0;
  const OCT3 = 4.3;
  const A1 = 0.55, A2 = 0.30, A3 = 0.15; // sums to 1.0 → |fieldVal| ≤ 1

  // Scalar field in [-1, 1] — fractal sum of three sine×cosine octaves.
  const fieldVal = (x, y) =>
      A1 * Math.sin(       freqX * x + phiX ) * Math.cos(       freqY * y + phiY )
    + A2 * Math.sin(OCT2 * freqX * x + phiX2) * Math.cos(OCT2 * freqY * y + phiY2)
    + A3 * Math.sin(OCT3 * freqX * x + phiX3) * Math.cos(OCT3 * freqY * y + phiY3);

  // Gradient direction — analytical derivative of the fractal field.
  // Used for local stroke orientation. Smaller-scale octaves dominate here,
  // which is why direction changes more often than color zones.
  const fieldRot = (x, y) => {
    const s1x = freqX * x + phiX,   s1y = freqY * y + phiY;
    const s2x = OCT2 * freqX * x + phiX2, s2y = OCT2 * freqY * y + phiY2;
    const s3x = OCT3 * freqX * x + phiX3, s3y = OCT3 * freqY * y + phiY3;
    const gx =
        A1 *         freqX * Math.cos(s1x) * Math.cos(s1y)
      + A2 * OCT2 *  freqX * Math.cos(s2x) * Math.cos(s2y)
      + A3 * OCT3 *  freqX * Math.cos(s3x) * Math.cos(s3y);
    const gy = -(
        A1 *         freqY * Math.sin(s1x) * Math.sin(s1y)
      + A2 * OCT2 *  freqY * Math.sin(s2x) * Math.sin(s2y)
      + A3 * OCT3 *  freqY * Math.sin(s3x) * Math.sin(s3y)
    );
    return Math.atan2(gy, gx);
  };

  // === WARP FIELD — breaks the hex lattice ===
  // Separate mid-frequency 2D displacement, phased by efficiency/rhr. Each
  // cell is pushed up to ~1 step along a body-dependent direction. Neighbors
  // see different warp directions at distance ~stepX, so the grid dissolves.
  const warpFx1 = freqX * 1.3, warpFy1 = freqY * 1.7;
  const warpFx2 = freqX * 1.9, warpFy2 = freqY * 1.1;
  const warpPhi1 = m.efficiency * Math.PI * 2;
  const warpPhi2 = m.rhr        * Math.PI * 2;
  const warpPhi3 = m.breath     * Math.PI * 2;
  const warpPhi4 = m.sleepHours * Math.PI * 2;
  // Returns a displacement vector scaled by `amp`.
  const warpVec = (x, y, amp) => {
    const dx = Math.sin(warpFy1 * y + warpPhi1) * Math.cos(warpFx1 * x + warpPhi2);
    const dy = Math.cos(warpFx2 * x + warpPhi3) * Math.sin(warpFy2 * y + warpPhi4);
    return [dx * amp, dy * amp];
  };

  // === DETAIL FIELD — high-frequency micro-modulation ===
  // Modulates per-stroke length and weight, independently of color. Breaks
  // the visual uniformity of neighbors sharing the same field zone. Phases
  // come from latency/breath — metrics previously under-used in the canvas.
  const detFx = freqX * 5.0, detFy = freqY * 5.0;
  const detPhi1 = m.latency * Math.PI * 2;
  const detPhi2 = m.breath  * Math.PI * 2;
  const detailVal = (x, y) =>
    Math.sin(detFx * x + detPhi1) * Math.cos(detFy * y + detPhi2);

  // === COMPOSITION ARMATURE ===
  // Readiness tilts the whole painting: good day ↗, bad day ↘. ±45°.
  const composeAngle = (m.readiness - 0.5) * (Math.PI / 2);
  // HRV controls how much the local field direction bends strokes away from
  // composeAngle. 0 = strict alignment, 1.5 = wide fan.
  const fieldAngleMix = m.hrv * 1.5;

  // Background
  const bg = backgroundColor(moodT, m);
  const bgL = rgbToHsl(bg[0], bg[1], bg[2])[2];
  p.background(bg[0], bg[1], bg[2]);

  // === DERIVED PARAMETERS (same semantics as before) ===
  const densityFactor   = 1 - moodT;                                             // 0 airy → 1 dense
  const baseLen         = 80 + (1 - m.rhr) * 200;                                // 80..280
  const lengthVariance  = 0.15 + m.hrv * 0.95;                                   // 0.15..1.10
  const baseWeight      = 7 + m.rhr * 18 + densityFactor * 16;                   // ~7..41
  const curvatureMul    = 0.3 + m.remPct * 2.2;                                  // 0.3..2.5
  const spreadMul       = 1.25 + (1 - m.efficiency) * 0.3;                       // 1.25..1.55
  const layers          = 1 + Math.floor(1 + densityFactor * 4);                 // 2..6
  const baseStrokeCount = Math.floor(12 + densityFactor * 26 + m.workoutIntensity * 1.5);
  const splatterCount   = Math.floor(m.workoutIntensity * 10 + m.workoutCount * 6 + 12);
  const jitterAmp       = m.restless;                                            // 0..1

  // === HALTON POINT CLOUD ===
  // Returns exactly `count` points inside (W*spread) × (H*spread), centered
  // on the origin. Baseline positions come from Halton(2,3) — a deterministic
  // aperiodic sequence that looks like blue noise. The cloud is IDENTICAL for
  // every day; body continuity is supplied by the warp field at call sites.
  // `startIdx` shifts into the sequence so different layers get different
  // points while still covering the whole canvas.
  function haltonCloud(count, spread, startIdx = 1) {
    const areaW = W * spread, areaH = H * spread;
    // Characteristic inter-point length — used as the warp amplitude scale.
    const scale = Math.sqrt((areaW * areaH) / Math.max(1, count));
    const pts = [];
    for (let i = 0; i < count; i++) {
      const n = startIdx + i;
      pts.push({
        x: (halton(n, 2) - 0.5) * areaW,
        y: (halton(n, 3) - 0.5) * areaH,
      });
    }
    return { pts, scale };
  }

  // === PHASE 1: UNDERPAINTING — broad flat sweeps on a Halton cloud ===
  oil.pick('flatLarge');
  const under = haltonCloud(Math.max(8, Math.floor(baseStrokeCount * 0.5)), spreadMul);
  for (const cell of under.pts) {
    // Warp-displaced position — smooth offset tied to body state
    const [wDx, wDy] = warpVec(cell.x, cell.y, under.scale * 1.0);
    const wx = cell.x + wDx;
    const wy = cell.y + wDy;

    const fv = fieldVal(wx, wy);
    const dv = detailVal(wx, wy);
    const color = pickColorField(m, moodT, bgL, fv, rng);
    oil.stroke(color[0], color[1], color[2]);

    // Detail field de-uniformizes weight within a color zone
    const weightMod = 0.80 + 0.45 * (0.5 - 0.5 * dv); // 0.80..1.25
    oil.strokeWeight(baseWeight * (0.9 + Math.abs(fv) * 0.6) * weightMod);

    const localAng = fieldRot(wx, wy);
    const angle = composeAngle + localAng * fieldAngleMix * 0.5;
    const lenMod = 0.70 + 0.65 * (0.5 + 0.5 * dv); // 0.70..1.35
    const len = baseLen * (0.8 + Math.abs(fv) * lengthVariance) * lenMod;

    // Residual restless jitter
    const px = wx + (rng() - 0.5) * under.scale * 0.3 * jitterAmp;
    const py = wy + (rng() - 0.5) * under.scale * 0.3 * jitterAmp;

    oil.line(
      px - Math.cos(angle) * len / 2, py - Math.sin(angle) * len / 2,
      px + Math.cos(angle) * len / 2, py + Math.sin(angle) * len / 2
    );
  }

  // === PHASE 2: MID-LAYER — curved filbert strokes on Halton clouds ===
  // Each layer picks a different slice of the Halton sequence, so their
  // clouds don't stack on top of each other. Since Halton(2,3) is aperiodic,
  // any two index ranges look like independent blue-noise distributions.
  for (let layer = 0; layer < layers; layer++) {
    oil.pick(layer % 2 === 0 ? 'filbertLarge' : 'filbertMedium');
    const layerCount = Math.floor(baseStrokeCount * (1 + layer * 0.25));
    const startIdx = 1 + layer * 419; // prime-ish offset keeps slices distinct
    const cloud = haltonCloud(layerCount, spreadMul, startIdx);

    for (const cell of cloud.pts) {
      // Warp displacement — each point migrates by ~1.1× its local spacing
      const [wDx, wDy] = warpVec(cell.x, cell.y, cloud.scale * 1.1);
      const wx = cell.x + wDx;
      const wy = cell.y + wDy;

      const fv = fieldVal(wx, wy);
      const dv = detailVal(wx, wy);
      const color = pickColorField(m, moodT, bgL, fv, rng);
      oil.stroke(color[0], color[1], color[2]);

      const weightMod = 0.75 + 0.55 * (0.5 - 0.5 * dv); // 0.75..1.30
      oil.strokeWeight(
        baseWeight * (0.55 + Math.abs(fv) * 0.8) * (1 - layer * 0.08) * weightMod
      );

      const localAng = fieldRot(wx, wy);
      const angle = composeAngle + localAng * fieldAngleMix;
      const lenMod = 0.65 + 0.75 * (0.5 + 0.5 * dv); // 0.65..1.40
      const len = baseLen * (0.55 + Math.abs(fv) * lengthVariance) * lenMod;

      const px = wx + (rng() - 0.5) * cloud.scale * 0.3 * jitterAmp;
      const py = wy + (rng() - 0.5) * cloud.scale * 0.3 * jitterAmp;

      // Serpentine multi-segment stroke that bends toward the local flow
      const segments = 3 + Math.floor(curvatureMul * 3);
      let x = px - Math.cos(angle) * len / 2;
      let y = py - Math.sin(angle) * len / 2;
      let curA = angle;
      const segLen = len / segments;
      const pts = [{ x, y }];
      for (let s = 0; s < segments; s++) {
        const targetA = fieldRot(x, y);
        let dA = targetA - curA;
        while (dA > Math.PI)  dA -= 2 * Math.PI;
        while (dA < -Math.PI) dA += 2 * Math.PI;
        curA += dA * curvatureMul * 0.18;
        curA += (rng() - 0.5) * 0.35 * jitterAmp;
        x += Math.cos(curA) * segLen;
        y += Math.sin(curA) * segLen;
        pts.push({ x, y });
      }
      for (let s = 0; s < pts.length - 1; s++) {
        oil.line(pts[s].x, pts[s].y, pts[s+1].x, pts[s+1].y);
      }
    }
  }

  // === PHASE 3: DRIPS & SPLATTERS — workout-driven, field-directed ===
  oil.pick('knifeSmall');
  for (let i = 0; i < splatterCount; i++) {
    // Positions pseudo-random (seeded by body) — splatters are physical scatter.
    const px = (rng() - 0.5) * W * spreadMul * 1.05;
    const py = (rng() - 0.5) * H * spreadMul * 1.05;
    const fv = fieldVal(px, py);
    const color = pickColorField(m, moodT, bgL, fv, rng);
    oil.stroke(color[0], color[1], color[2]);
    oil.strokeWeight(2 + Math.abs(fv) * 5);

    // Trail follows local flow so drips read as a continuation of the field.
    const tangle = fieldRot(px, py);
    const tlen = 3 + rng() * 18;
    oil.line(px, py, px + Math.cos(tangle) * tlen, py + Math.sin(tangle) * tlen);

    const nSpatter = 1 + Math.floor(rng() * 4);
    for (let s = 0; s < nSpatter; s++) {
      const sa = tangle + (rng() - 0.5) * 1.6;
      const sd = 4 + rng() * 25;
      const ox = px + Math.cos(sa) * sd;
      const oy = py + Math.sin(sa) * sd;
      oil.line(ox, oy, ox + (rng() - 0.5) * 4, oy + (rng() - 0.5) * 4);
    }
  }

  // === PHASE 4: IMPASTO ACCENTS AT FIELD PEAKS ===
  // Sample a Halton cloud and pick top-k by fractal field value — the
  // brightest moments of the day. With a multi-octave field and a non-grid
  // candidate cloud, peaks are neither evenly spaced nor lattice-aligned.
  oil.pick('impasto');
  const impastoCount = 3 + Math.floor(m.workoutIntensity * 0.6 + (1 - m.latency) * 5);
  const candCloud = haltonCloud(Math.max(impastoCount * 12, 80), 0.85, 2999);
  const ranked = candCloud.pts
    .map(c => ({ c, f: fieldVal(c.x, c.y) }))
    .sort((a, b) => b.f - a.f)
    .slice(0, impastoCount);
  for (const { c, f: fv } of ranked) {
    const dv = detailVal(c.x, c.y);
    const color = pickColorField(m, Math.min(1, moodT + 0.15), bgL, fv, rng);
    oil.stroke(color[0], color[1], color[2]);
    const weightMod = 0.85 + 0.4 * (0.5 - 0.5 * dv);
    oil.strokeWeight(baseWeight * (1.2 + Math.abs(fv) * 0.8) * weightMod);
    const localAng = fieldRot(c.x, c.y);
    const angle = composeAngle + localAng * fieldAngleMix;
    const lenMod = 0.75 + 0.5 * (0.5 + 0.5 * dv);
    const len = baseLen * (0.45 + Math.abs(fv) * 0.55) * lenMod;
    oil.line(
      c.x - Math.cos(angle) * len / 2, c.y - Math.sin(angle) * len / 2,
      c.x + Math.cos(angle) * len / 2, c.y + Math.sin(angle) * len / 2
    );
  }

  // === PHASE 5: RESTLESS NIGHT NOISE — edge scatter ===
  if (m.restless > 0.6) {
    oil.pick('knifeSmall');
    const noise = Math.floor(m.restless * 40);
    for (let i = 0; i < noise; i++) {
      const px = (rng() - 0.5) * W * 1.1;
      const py = (rng() - 0.5) * H * 1.1;
      const fv = fieldVal(px, py);
      const color = pickColorField(m, moodT, bgL, fv, rng);
      oil.stroke(color[0], color[1], color[2]);
      oil.strokeWeight(1 + rng() * 3);
      oil.line(px, py, px + (rng() - 0.5) * 8, py + (rng() - 0.5) * 8);
    }
  }

  oil.flush();

  return {
    m, moodT,
    params: {
      composeAngle, freqX, freqY,
      baseLen, lengthVariance, baseWeight, curvatureMul,
      layers, baseStrokeCount, splatterCount,
    },
  };
}

// Expose globally
window.OuraPainter = { paintDay, normalizeMetrics, hashMetrics, buildPercentiles, percentile };
