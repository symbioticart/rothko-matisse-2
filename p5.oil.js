// p5.oil — Oil painting brushes for p5.js
// https://github.com/symbioticart/p5.oil
// MIT License
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else factory();
}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
'use strict';

// === UTILS ===
const { abs, sin, cos, sqrt, PI, floor, min, max, pow, atan2, random: mathRandom, log, exp } = Math;
const TAU = PI * 2;

let _seed = 42;
function seed(s) { _seed = s | 0; }
function rand01() {
  _seed |= 0; _seed = _seed + 0x6D2B79F5 | 0;
  let t = Math.imul(_seed ^ _seed >>> 15, 1 | _seed);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
function rand(a, b) { return a + rand01() * (b - a); }
function randInt(a, b) { return floor(rand(a, b + 0.99)); }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function gauss() {
  let u = 0, v = 0;
  while (!u) u = rand01();
  while (!v) v = rand01();
  return sqrt(-2 * log(u)) * cos(TAU * v);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return max(lo, min(hi, v)); }

class Noise {
  constructor(s = 42) {
    this.p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) {
      s = (s * 16807) % 2147483647;
      this.p[i] = this.p[i + 256] = s & 255;
    }
  }
  _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  _grad(h, x) { return (h & 1) ? -x : x; }
  n(x) {
    const i = floor(x) & 255, f = x - floor(x), u = this._fade(f);
    return lerp(this._grad(this.p[i], f), this._grad(this.p[i + 1], f - 1), u);
  }
  fbm(x, oct = 4) {
    let v = 0, a = 1, fr = 1, mx = 0;
    for (let i = 0; i < oct; i++) { v += this.n(x * fr) * a; mx += a; a *= 0.5; fr *= 2; }
    return v / mx;
  }
}

function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  const c = (1 - abs(2 * l - 1)) * s, x = c * (1 - abs((h / 60) % 2 - 1)), m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [(r + m), (g + m), (b + m)];
}

function parseColor(c) {
  if (Array.isArray(c)) {
    if (c.length >= 3) return [c[0] / 255, c[1] / 255, c[2] / 255];
    return [c[0] / 255, c[0] / 255, c[0] / 255];
  }
  if (typeof c === "string") {
    if (c.startsWith("#")) {
      const hex = c.slice(1);
      const n = parseInt(hex, 16);
      if (hex.length === 3) return [((n >> 8) & 0xf) / 15, ((n >> 4) & 0xf) / 15, (n & 0xf) / 15];
      return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
    }
  }
  if (typeof c === "number") return [c / 255, c / 255, c / 255];
  if (c && typeof c.levels !== "undefined") {
    const l = c.levels || c._array;
    if (l) return [l[0] / 255, l[1] / 255, l[2] / 255];
  }
  return [0, 0, 0];
}

// === PRESSURE ===
function makePressureCurve() {
  const type = (rand01() * 6) | 0;
  const peak = rand(0.2, 0.8);
  const asymm = rand(0.5, 2);
  const jitter = rand(0, 0.1);
  const plateauW = rand(0.15, 0.5);
  return function pressureFn(t) {
    let p;
    switch (type) {
      case 0: p = Math.exp(-pow((t - peak) / (t < peak ? 0.3 * asymm : 0.3 / asymm), 2)); break;
      case 1: p = t < peak ? pow(t / peak, rand(0.5, 2)) : pow(max(0, 1 - (t - peak) / (1 - peak)), rand(2, 5)); break;
      case 2: p = t < peak - plateauW / 2 ? pow(t / (peak - plateauW / 2), rand(0.5, 1.5))
        : t > peak + plateauW / 2 ? pow(max(0, 1 - (t - peak - plateauW / 2) / (1 - peak - plateauW / 2)), rand(0.5, 1.5)) : 1; break;
      case 3: p = max(0, sin(t * PI) * 0.5 + sin(t * PI * 2.3 + rand(0, PI)) * 0.5); break;
      case 4: p = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : rand(0.7, 1); break;
      default: p = pow(max(0, 1 - t), rand(0.3, 1.5)); break;
    }
    return clamp(p + gauss() * jitter, 0.05, 1);
  };
}

// === GL ENGINE ===
const VERT_SRC = `#version 300 es
precision highp float;
in vec2 a_pos;
in vec4 a_xyrAlpha;
in vec4 a_color;
uniform vec2 u_resolution;
out vec4 v_color;
out vec2 v_uv;
void main() {
  float x = a_xyrAlpha.x;
  float y = a_xyrAlpha.y;
  float r = a_xyrAlpha.z;
  float alpha = a_xyrAlpha.w;
  vec2 pos = a_pos * r + vec2(x, y);
  // WEBGL mode: (0,0) is center, so offset by half resolution
  vec2 clip = pos / (u_resolution * 0.5);
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = vec4(a_color.rgb, alpha);
  v_uv = a_pos;
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec4 v_color;
in vec2 v_uv;
out vec4 fragColor;
void main() {
  float dist = length(v_uv);
  if (dist > 1.0) discard;
  float edge = 1.0 - smoothstep(0.7, 1.0, dist);
  fragColor = vec4(v_color.rgb, v_color.a * edge);
}`;

class GLEngine {
  constructor() {
    this.gl = null; this.program = null; this.circleVAO = null;
    this.instanceBuffer = null; this.colorBuffer = null;
    this.capacity = 4096; this.count = 0;
    this.instanceData = null; this.colorData = null; this.ready = false;
  }
  init(gl) {
    this.gl = gl;
    const prog = this._createProgram(VERT_SRC, FRAG_SRC);
    if (!prog) return;
    this.program = prog;
    this.loc_aPos = gl.getAttribLocation(prog, "a_pos");
    this.loc_aXYRA = gl.getAttribLocation(prog, "a_xyrAlpha");
    this.loc_aColor = gl.getAttribLocation(prog, "a_color");
    this.loc_uRes = gl.getUniformLocation(prog, "u_resolution");
    const segments = 16;
    const verts = [0, 0];
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      verts.push(Math.cos(a), Math.sin(a));
    }
    this.circleVertCount = segments + 2;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.loc_aPos);
    gl.vertexAttribPointer(this.loc_aPos, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    this.instanceData = new Float32Array(this.capacity * 4);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc_aXYRA);
    gl.vertexAttribPointer(this.loc_aXYRA, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.loc_aXYRA, 1);
    this.colorBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    this.colorData = new Float32Array(this.capacity * 4);
    gl.bufferData(gl.ARRAY_BUFFER, this.colorData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.loc_aColor);
    gl.vertexAttribPointer(this.loc_aColor, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.loc_aColor, 1);
    gl.bindVertexArray(null);
    this.circleVAO = vao;
    this.count = 0;
    this.ready = true;
  }
  _createProgram(vs, fs) {
    const gl = this.gl;
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vs); gl.compileShader(vShader);
    if (!gl.getShaderParameter(vShader, gl.COMPILE_STATUS)) { console.error("p5.oil vertex shader:", gl.getShaderInfoLog(vShader)); return null; }
    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fs); gl.compileShader(fShader);
    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) { console.error("p5.oil fragment shader:", gl.getShaderInfoLog(fShader)); return null; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vShader); gl.attachShader(prog, fShader); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error("p5.oil program link:", gl.getProgramInfoLog(prog)); return null; }
    return prog;
  }
  addCircle(x, y, radius, r, g, b, alpha) {
    if (this.count >= this.capacity) this._grow();
    const i = this.count * 4;
    this.instanceData[i] = x; this.instanceData[i + 1] = y;
    this.instanceData[i + 2] = radius; this.instanceData[i + 3] = alpha;
    this.colorData[i] = r; this.colorData[i + 1] = g;
    this.colorData[i + 2] = b; this.colorData[i + 3] = 1.0;
    this.count++;
  }
  _grow() {
    this.capacity *= 2;
    const newInst = new Float32Array(this.capacity * 4);
    newInst.set(this.instanceData); this.instanceData = newInst;
    const newCol = new Float32Array(this.capacity * 4);
    newCol.set(this.colorData); this.colorData = newCol;
  }
  flush() {
    if (!this.ready || this.count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.loc_uRes, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.circleVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.subarray(0, this.count * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.colorData.subarray(0, this.count * 4), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, this.circleVertCount, this.count);
    gl.bindVertexArray(null);
    this.count = 0;
  }
}

// === BRUSHES ===
const builtinBrushes = {
  flatLarge: { type: "flat", weight: 1.0, bristles: [10, 18], taper: [0.1, 0.35], oval: [0.9, 1.0], curveSway: [0.0, 0.4], deplete: [0.05, 0.3], chaos: [0.5, 1.5], dryBrush: 0.1, opacity: [0.5, 0.85], spacing: 0.8 },
  flatMedium: { type: "flat", weight: 0.6, bristles: [7, 14], taper: [0.1, 0.4], oval: [0.9, 1.0], curveSway: [0.0, 0.6], deplete: [0.05, 0.4], chaos: [0.4, 1.8], dryBrush: 0.15, opacity: [0.4, 0.8], spacing: 0.9 },
  flatSmall: { type: "flat", weight: 0.3, bristles: [5, 10], taper: [0.15, 0.5], oval: [0.9, 1.0], curveSway: [0.0, 0.8], deplete: [0.1, 0.5], chaos: [0.5, 2.0], dryBrush: 0.2, opacity: [0.3, 0.75], spacing: 1.0 },
  filbertLarge: { type: "filbert", weight: 0.9, bristles: [8, 16], taper: [0.35, 0.9], oval: [0.25, 0.65], curveSway: [0.1, 0.8], deplete: [0.05, 0.35], chaos: [0.6, 1.8], dryBrush: 0.08, opacity: [0.45, 0.85], spacing: 0.9 },
  filbertMedium: { type: "filbert", weight: 0.55, bristles: [6, 14], taper: [0.4, 1.1], oval: [0.2, 0.6], curveSway: [0.1, 1.0], deplete: [0.05, 0.45], chaos: [0.8, 2.2], dryBrush: 0.12, opacity: [0.4, 0.8], spacing: 1.0 },
  filbertSmall: { type: "filbert", weight: 0.25, bristles: [5, 10], taper: [0.5, 1.3], oval: [0.15, 0.55], curveSway: [0.2, 1.2], deplete: [0.1, 0.5], chaos: [1.0, 2.5], dryBrush: 0.15, opacity: [0.35, 0.75], spacing: 1.1 },
  round: { type: "filbert", weight: 0.4, bristles: [6, 12], taper: [0.6, 1.2], oval: [0.4, 0.8], curveSway: [0.1, 1.0], deplete: [0.1, 0.5], chaos: [0.6, 2.0], dryBrush: 0.1, opacity: [0.4, 0.8], spacing: 1.0 },
  knife: { type: "knife", weight: 0.8, bristles: [2, 5], taper: [0.05, 0.2], oval: [0.9, 1.0], curveSway: [0.0, 0.2], deplete: [0.0, 0.1], chaos: [0.2, 0.6], dryBrush: 0.0, opacity: [0.75, 0.95], spacing: 0.5 },
  knifeSmall: { type: "knife", weight: 0.4, bristles: [2, 4], taper: [0.05, 0.15], oval: [0.9, 1.0], curveSway: [0.0, 0.3], deplete: [0.0, 0.15], chaos: [0.2, 0.8], dryBrush: 0.0, opacity: [0.7, 0.92], spacing: 0.5 },
  impasto: { type: "flat", weight: 1.2, bristles: [8, 16], taper: [0.1, 0.3], oval: [0.9, 1.0], curveSway: [0.1, 0.5], deplete: [0.0, 0.15], chaos: [0.4, 1.2], dryBrush: 0.0, opacity: [0.7, 0.95], spacing: 0.6 },
};

// === STROKE STATE ===
let _currentBrush = "filbertMedium";
let _color = [0.3, 0.2, 0.1];
let _weight = 10;
let _opacity = 1.0;
let _hasStroke = true;
const _customBrushes = {};
const _stack = [];

function pushState() { _stack.push({ brush: _currentBrush, color: [..._color], weight: _weight, opacity: _opacity, hasStroke: _hasStroke }); }
function popState() { if (!_stack.length) return; const s = _stack.pop(); _currentBrush = s.brush; _color = s.color; _weight = s.weight; _opacity = s.opacity; _hasStroke = s.hasStroke; }

function strokeSet(brushName, color, weight) {
  if (brushName) _currentBrush = brushName;
  if (color !== undefined) strokeSetColor(color);
  if (weight !== undefined) _weight = weight;
}
function strokeSetColor(c) {
  if (Array.isArray(c)) { _color = c[0] > 1 ? [c[0]/255, c[1]/255, c[2]/255] : [...c]; }
  else if (typeof c === "number") { const v = c > 1 ? c/255 : c; _color = [v,v,v]; }
}
function strokeColor(r, g, b) {
  if (g === undefined) { strokeSetColor(r); return; }
  _color = [r > 1 ? r/255 : r, g > 1 ? g/255 : g, b > 1 ? b/255 : b];
}
function strokeWeightSet(w) { _weight = w; }
function noStrokeSet() { _hasStroke = false; }
function enableStrokeSet() { _hasStroke = true; }
function pickBrush(name) { _currentBrush = name; }
function boxBrushes() { return [...Object.keys(builtinBrushes), ...Object.keys(_customBrushes)]; }
function addBrush(name, params) { _customBrushes[name] = { ...params }; }

function getBrushDef() { return _customBrushes[_currentBrush] || builtinBrushes[_currentBrush] || builtinBrushes.filbertMedium; }
function randRange(arr) { return Array.isArray(arr) ? rand(arr[0], arr[1]) : arr; }

// === STROKE RENDERING ===
function drawStroke(engine, x0, y0, x1, y1) {
  if (!_hasStroke) return;
  const def = getBrushDef();
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return;
  const angle = Math.atan2(dy, dx);
  _drawBristleStroke(engine, x0, y0, len, angle, def);
}
function drawFlowStroke(engine, x0, y0, length, direction) {
  if (!_hasStroke) return;
  _drawBristleStroke(engine, x0, y0, length, direction, getBrushDef());
}
function drawSpline(engine, points, curvature) {
  if (!_hasStroke || points.length < 2) return;
  const def = getBrushDef();
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;
    _drawBristleStroke(engine, p0.x, p0.y, len, Math.atan2(dy, dx), def);
  }
}

function _drawBristleStroke(engine, x0, y0, len, baseAngle, def) {
  const noise = new Noise(randInt(0, 99999));
  const width = _weight * def.weight;
  const bristles = randInt(randRange(def.bristles) * 0.8, randRange(def.bristles) * 1.2);
  const taper = randRange(def.taper);
  const oval = randRange(def.oval);
  const curveSway = randRange(def.curveSway);
  const curveFreq = rand(0.5, 3);
  const deplete = randRange(def.deplete);
  const chaos = randRange(def.chaos);
  const baseAlpha = randRange(def.opacity) * _opacity;
  const twist = rand(-0.4, 0.4);
  const dryBrush = Math.random() < def.dryBrush ? rand(0.3, 1) : 0;
  const pressureFn = makePressureCurve();

  const steps = max(8, floor(len / 1));
  const spacing = def.spacing || 1;

  const path = new Float64Array((steps + 1) * 3);
  let px = x0, py = y0, curA = baseAngle;
  path[0] = px; path[1] = py; path[2] = curA;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    curA = baseAngle
      + curveSway * sin(t * PI * curveFreq)
      + curveSway * 0.3 * sin(t * PI * curveFreq * 2.7 + rand(0, PI))
      + noise.fbm(t * 4, 3) * 0.15 * chaos;
    px += cos(curA) * (len / steps);
    py += sin(curA) * (len / steps);
    const idx = i * 3;
    path[idx] = px; path[idx + 1] = py; path[idx + 2] = curA;
  }

  const layers = width > 15 && Math.random() > 0.4 ? 2 : 1;

  for (let layer = 0; layer < layers; layer++) {
    const lr = clamp(_color[0] + rand(-0.04, 0.04) * chaos, 0, 1);
    const lg = clamp(_color[1] + rand(-0.03, 0.03) * chaos, 0, 1);
    const lb = clamp(_color[2] + rand(-0.03, 0.03) * chaos, 0, 1);

    for (let b = 0; b < bristles; b++) {
      const bN = b / max(1, bristles - 1);
      const bOff = (bN - 0.5) * width;
      const edgeDist = abs(bN - 0.5) * 2;

      const bStiff = rand(0.5, 1.5);
      const bWand = rand(0.3, 2.5) * chaos;
      const bThick = rand(0.6, 1.8);
      const bGrain = rand(0, 0.4);
      const ovalF = oval < 1 ? pow(max(0, 1 - pow(edgeDist, 2)), oval) : 1;

      const br = clamp(lr + rand(-0.02, 0.02), 0, 1);
      const bg = clamp(lg + rand(-0.015, 0.015), 0, 1);
      const bb = clamp(lb + rand(-0.015, 0.015), 0, 1);

      const edgeFade = 1 - pow(edgeDist, rand(1, 2.5));
      const bristleAlpha = clamp(baseAlpha * (0.3 + edgeFade * 0.7) * (0.8 + layer * 0.2) * rand(0.7, 1.3), 0.05, 0.92);

      const stepSkip = max(1, floor(spacing * 1.5));
      for (let i = 0; i <= steps; i += stepSkip) {
        const t = i / steps;
        const idx = min(i, steps) * 3;
        const ptX = path[idx], ptY = path[idx + 1], ptA = path[idx + 2];

        const pressure = pressureFn(t);
        const taperF = pow(sin(clamp(t * PI, 0, PI)), taper);
        const deplF = 1 - t * deplete;
        const twistF = 1 + twist * sin(t * PI * rand(1, 3));

        if (dryBrush > 0 && Math.random() < bGrain * dryBrush && t > 0.3) continue;

        const totalOff = bOff * taperF * ovalF * pressure * twistF * deplF;
        const wander = noise.fbm(t * 6 * bStiff + b * 0.7 + layer * 3, 3) * bWand * 3;
        const ox = (-sin(ptA)) * (totalOff + wander);
        const oy = (cos(ptA)) * (totalOff + wander);

        const radius = max(0.5, width / bristles * bThick * ovalF * pressure * 2.0);

        engine.addCircle(ptX + ox, ptY + oy, radius, br, bg, bb, bristleAlpha * pressure * deplF);
      }
    }
  }

  if (Math.random() > 0.5) {
    const hlStart = floor(steps * rand(0.15, 0.4));
    const hlEnd = floor(steps * rand(0.5, 0.85));
    for (let i = hlStart; i <= hlEnd; i += max(1, floor(spacing * 3))) {
      const idx = min(i, steps) * 3;
      const ptX = path[idx], ptY = path[idx + 1], ptA = path[idx + 2];
      const off = rand(-width * 0.3, width * 0.3);
      engine.addCircle(ptX + (-sin(ptA)) * off, ptY + (cos(ptA)) * off, rand(0.3, 1.5), 1, 1, 0.95, rand(0.01, 0.05));
    }
  }
}

// === ADDON REGISTRATION ===
let _engine = null;
let _p5Instance = null;
let _bound = false;

function getGL(inst) {
  const r = inst._renderer;
  if (r && r.GL) return r.GL;
  if (r && r.drawingContext && r.drawingContext instanceof WebGL2RenderingContext) return r.drawingContext;
  if (inst.drawingContext && inst.drawingContext instanceof WebGL2RenderingContext) return inst.drawingContext;
  return null;
}

const oil = {
  set: function(brush, color, weight) {
    if (color !== undefined) { const c = parseColor(color); strokeSetColor(c); }
    strokeSet(brush, undefined, weight);
  },
  pick: function(brush) { pickBrush(brush); },
  stroke: function(r, g, b) {
    if (g === undefined) { const c = parseColor(r); strokeColor(c[0], c[1], c[2]); }
    else { strokeColor(r, g, b); }
    enableStrokeSet();
  },
  noStroke: function() { noStrokeSet(); },
  strokeWeight: function(w) { strokeWeightSet(w); },
  box: function() { return boxBrushes(); },
  add: function(name, params) { addBrush(name, params); },
  seed: function(s) { seed(s); },
  line: function(x1, y1, x2, y2) { drawStroke(_engine, x1, y1, x2, y2); },
  flowLine: function(x, y, length, direction) { drawFlowStroke(_engine, x, y, length, direction); },
  rect: function(x, y, w, h) {
    drawStroke(_engine, x, y, x + w, y);
    drawStroke(_engine, x + w, y, x + w, y + h);
    drawStroke(_engine, x + w, y + h, x, y + h);
    drawStroke(_engine, x, y + h, x, y);
  },
  circle: function(x, y, r) {
    const segs = Math.max(12, Math.floor(r * 0.5));
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      drawStroke(_engine, x + Math.cos(a0) * r, y + Math.sin(a0) * r, x + Math.cos(a1) * r, y + Math.sin(a1) * r);
    }
  },
  spline: function(points, curvature) { drawSpline(_engine, points, curvature); },
  flush: function() { if (_engine && _engine.ready) _engine.flush(); },
  scaleBrushes: function(s) {},
};

if (typeof globalThis !== "undefined") globalThis.oil = oil;
if (typeof window !== "undefined") window.oil = oil;

function registerP5Addon(_p5, fn, lifecycles) {
  _engine = new GLEngine();
  lifecycles.postsetup = function () {
    _p5Instance = this;
    const gl = getGL(this);
    if (gl && !_bound) { _engine.init(gl); _bound = true; }
  };
  lifecycles.predraw = function () {
    _p5Instance = this;
    if (!_bound) { const gl = getGL(this); if (gl) { _engine.init(gl); _bound = true; } }
  };
  lifecycles.postdraw = function () {
    if (_engine.ready) _engine.flush();
  };
  const _origPush = fn.push;
  const _origPop = fn.pop;
  fn.push = function () { _origPush && _origPush.call(this); pushState(); };
  fn.pop = function () { _origPop && _origPop.call(this); popState(); };
}

// Auto-register if p5 is available
if (typeof p5 !== "undefined") {
  p5.registerAddon(registerP5Addon);
}

return { registerP5Addon: registerP5Addon, oil: oil };
}));
