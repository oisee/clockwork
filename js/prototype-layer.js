/**
 * Parametric motion-design prototyping layer for Clockwork.
 *
 * Renders formula-driven effects to a 256x192 canvas — the same resolution
 * as the ZX Spectrum screen.  Designed for rapid prototyping of demoscene
 * sync tracks: write a formula, see it animate, then compare against the
 * real Spectrum output via overlay compositing.
 *
 * Four exports:
 *   FormulaEngine  — safe expression compiler (math-only sandbox)
 *   Track          — named parametric animation track
 *   PrototypeRenderer — renders built-in effects to 256x192
 *   OverlayCompositor — blends prototype + Spectrum layers
 */

// ---------------------------------------------------------------------------
// 1. Helper functions available inside formulas
// ---------------------------------------------------------------------------

/** Linear interpolation. */
function lerp(a, b, t) { return a + (b - a) * t; }

/** Hermite smoothstep (clamped). */
function smoothstep(a, b, t) {
  const x = clamp((t - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
}

/** Clamp x to [lo, hi]. */
function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

/** Fractional part (always positive). */
function fract(x) { return x - Math.floor(x); }

// -- Noise ------------------------------------------------------------------

/**
 * Simple 1D value noise.  Deterministic, hash-based.
 * Returns values in [0, 1].
 */
function noise(x) {
  const xi = Math.floor(x);
  const f = x - xi;
  const a = _hash1(xi);
  const b = _hash1(xi + 1);
  return lerp(a, b, f * f * (3 - 2 * f));
}

/**
 * Simple 2D value noise.  Deterministic.
 * Returns values in [0, 1].
 */
function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = _hash2(xi, yi);
  const n10 = _hash2(xi + 1, yi);
  const n01 = _hash2(xi, yi + 1);
  const n11 = _hash2(xi + 1, yi + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}

/** Integer hash -> [0, 1].  Based on Hugo Elias / Squirrel Eiserloh. */
function _hash1(n) {
  n = (n << 13) ^ n;
  n = (n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff;
  return n / 0x7fffffff;
}

/** 2D integer hash -> [0, 1]. */
function _hash2(x, y) {
  return _hash1(x + y * 57);
}

// -- Easing -----------------------------------------------------------------

/** Quadratic ease in (t^2). */
function easeIn(t) { return t * t; }

/** Quadratic ease out. */
function easeOut(t) { return t * (2 - t); }

/** Smooth ease in/out (cubic Hermite). */
function easeInOut(t) { return t * t * (3 - 2 * t); }

/** Bounce easing (single bounce at the end). */
function bounce(t) {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t;
  } else if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  } else if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  } else {
    const t2 = t - 2.625 / 2.75;
    return 7.5625 * t2 * t2 + 0.984375;
  }
}

/** Elastic easing (spring overshoot). */
function elastic(t) {
  if (t === 0 || t === 1) return t;
  return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
}

/** Step function: 0 if x < edge, 1 otherwise. */
function step(edge, x) { return x < edge ? 0 : 1; }

/** Pulse: 1 if |t - center| < width/2, else 0. */
function pulse(t, center, width) {
  return Math.abs(t - center) < width / 2 ? 1 : 0;
}


// ---------------------------------------------------------------------------
// 2. FormulaEngine — safe expression evaluator
// ---------------------------------------------------------------------------

/**
 * All names that are available inside a formula expression.
 * This list is used both for compilation and for building the arguments
 * object, so it must be kept in sync.
 */
const BUILTIN_NAMES = [
  // Math functions
  'sin', 'cos', 'abs', 'floor', 'ceil', 'round', 'min', 'max',
  'pow', 'sqrt', 'log',
  // Constants
  'PI', 'TAU',
  // Helpers
  'lerp', 'smoothstep', 'clamp', 'fract',
  'noise', 'noise2',
  'easeIn', 'easeOut', 'easeInOut', 'bounce', 'elastic',
  'step', 'pulse',
];

/** Values for the built-in names (same order as BUILTIN_NAMES). */
const BUILTIN_VALUES = [
  Math.sin, Math.cos, Math.abs, Math.floor, Math.ceil, Math.round,
  Math.min, Math.max, Math.pow, Math.sqrt, Math.log,
  Math.PI, Math.PI * 2,
  lerp, smoothstep, clamp, fract,
  noise, noise2,
  easeIn, easeOut, easeInOut, bounce, elastic,
  step, pulse,
];

/**
 * Variable names available from the track context.
 * Passed in at evaluation time.
 */
const VAR_NAMES = ['t', 'frame', 'beat', 'bpm'];

export class FormulaEngine {
  constructor() {
    // The full parameter list for compiled functions:
    // first the track variables, then every built-in name.
    this.paramNames = [...VAR_NAMES, ...BUILTIN_NAMES];
  }

  /**
   * Compile an expression string into a callable function.
   *
   * Variables available inside the expression:
   *   t      — normalized time (0..1 across the scene)
   *   frame  — integer frame number
   *   beat   — float beat count (based on bpm)
   *   bpm    — beats per minute
   *   ...and all built-in math functions / helpers listed above.
   *
   * The approach: build a Function whose formal parameters are all known
   * names.  No `with`, no `eval`, no access to globals beyond the
   * explicit whitelist.
   *
   * @param {string} expr  Formula string, e.g. "sin(t * TAU) * 128 + 128"
   * @returns {{ fn: Function, src: string }}  Compiled callable + source for debugging
   * @throws {Error} on syntax error
   */
  compile(expr) {
    // eslint-disable-next-line no-new-func
    const fn = new Function(...this.paramNames, `"use strict"; return (${expr});`);
    return { fn, src: expr };
  }

  /**
   * Evaluate a compiled formula with given variables.
   *
   * @param {{ fn: Function }} compiled  Output of compile()
   * @param {Object} vars  Must contain t, frame, beat, bpm (and any custom vars
   *                       are currently not supported — extend paramNames if needed)
   * @returns {number}
   */
  evaluate(compiled, vars) {
    return compiled.fn(
      vars.t ?? 0,
      vars.frame ?? 0,
      vars.beat ?? 0,
      vars.bpm ?? 125,
      ...BUILTIN_VALUES
    );
  }
}


// ---------------------------------------------------------------------------
// 3. Track — named parametric animation track
// ---------------------------------------------------------------------------

/** Shared engine instance for all tracks. */
const engine = new FormulaEngine();

export class Track {
  /**
   * @param {string} name      Track name (e.g. "plasma.speed", "camera.x")
   * @param {string} formula   Expression string
   * @param {Object} [defaults]  Default values for custom variables
   */
  constructor(name, formula, defaults = {}) {
    this.name = name;
    this.formula = formula;
    this.defaults = defaults;
    this.compiled = engine.compile(formula);
  }

  /**
   * Evaluate this track at a given frame.
   *
   * @param {number} frame        Current frame number
   * @param {number} totalFrames  Total frames in the scene
   * @param {number} [bpm=125]    Beats per minute (ZX Spectrum demos often use 125)
   * @returns {number}
   */
  evaluate(frame, totalFrames, bpm = 125) {
    const t = totalFrames > 0 ? frame / totalFrames : 0;
    const beat = frame / (50 * 60 / bpm); // frames per beat at 50 Hz
    return engine.evaluate(this.compiled, {
      t, frame, beat, bpm,
      ...this.defaults,
    });
  }

  /**
   * Replace the formula (e.g. from a UI text field).
   * Throws on syntax error — caller should catch and show message.
   *
   * @param {string} newFormula
   */
  setFormula(newFormula) {
    this.compiled = engine.compile(newFormula);
    this.formula = newFormula;
  }
}


// ---------------------------------------------------------------------------
// 4. PrototypeRenderer — renders effects to 256x192
// ---------------------------------------------------------------------------

/**
 * ZX Spectrum palette (normal brightness), used by effects that want
 * authentic-looking colors.  Same values as spectrum.js PALETTE[0..7].
 */
const SPEC_COLORS = [
  [0x00, 0x00, 0x00], // black
  [0x00, 0x00, 0xD7], // blue
  [0xD7, 0x00, 0x00], // red
  [0xD7, 0x00, 0xD7], // magenta
  [0x00, 0xD7, 0x00], // green
  [0x00, 0xD7, 0xD7], // cyan
  [0xD7, 0xD7, 0x00], // yellow
  [0xD7, 0xD7, 0xD7], // white
];

export class PrototypeRenderer {
  /**
   * @param {HTMLCanvasElement} canvas  Should be 256x192
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 256;
    this.height = 192;

    // Ensure canvas dimensions are correct
    canvas.width = this.width;
    canvas.height = this.height;

    /** @type {Map<string, function(CanvasRenderingContext2D, number, number, Object): void>} */
    this.effects = new Map();

    this.registerBuiltinEffects();
  }

  /**
   * Register a named effect.
   *
   * @param {string} name
   * @param {function(CanvasRenderingContext2D, number, number, Object): void} renderFn
   *   Signature: (ctx, width, height, params) => void
   *   params is an object of evaluated track values.
   */
  register(name, renderFn) {
    this.effects.set(name, renderFn);
  }

  /**
   * Render a single frame of the named effect.
   *
   * @param {string} effectName
   * @param {Object} params  Evaluated track values for this frame
   */
  render(effectName, params) {
    const fn = this.effects.get(effectName);
    if (!fn) {
      // Unknown effect — clear to black and draw error text
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.fillStyle = '#f33';
      this.ctx.font = '10px monospace';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(`Unknown effect: ${effectName}`, this.width / 2, this.height / 2);
      return;
    }
    fn(this.ctx, this.width, this.height, params);
  }

  /**
   * Get the current canvas contents as ImageData (for compositing).
   *
   * @returns {ImageData}
   */
  getImageData() {
    return this.ctx.getImageData(0, 0, this.width, this.height);
  }

  // -----------------------------------------------------------------------
  // Built-in demo effects
  // -----------------------------------------------------------------------

  registerBuiltinEffects() {
    this.register('plasma', renderPlasma);
    this.register('bars', renderBars);
    this.register('lissajous', renderLissajous);
    this.register('starfield', renderStarfield);
  }
}


// -- Plasma -----------------------------------------------------------------

/**
 * Color gradient palettes for the plasma effect.
 * Each is a function mapping a value in [0, 1] to [R, G, B].
 */
const PLASMA_PALETTES = [
  // 0 — rainbow
  (v) => [
    Math.floor(128 + 127 * Math.sin(Math.PI * 2 * v)),
    Math.floor(128 + 127 * Math.sin(Math.PI * 2 * v + 2.094)),
    Math.floor(128 + 127 * Math.sin(Math.PI * 2 * v + 4.189)),
  ],
  // 1 — fire
  (v) => [
    Math.floor(Math.min(255, v * 510)),
    Math.floor(Math.max(0, Math.min(255, (v - 0.4) * 510))),
    Math.floor(Math.max(0, Math.min(255, (v - 0.75) * 1020))),
  ],
  // 2 — ice
  (v) => [
    Math.floor(Math.max(0, Math.min(255, (v - 0.5) * 510))),
    Math.floor(Math.max(0, Math.min(255, (v - 0.25) * 510))),
    Math.floor(128 + 127 * v),
  ],
];

/**
 * Classic demoscene plasma.
 * Params: speed (default 1), scale (default 1), palette (0=rainbow, 1=fire, 2=ice).
 */
function renderPlasma(ctx, w, h, params) {
  const speed = params.speed ?? 1;
  const scale = params.scale ?? 1;
  const palIdx = Math.floor(params.palette ?? 0) % PLASMA_PALETTES.length;
  const pal = PLASMA_PALETTES[Math.abs(palIdx)] ?? PLASMA_PALETTES[0];
  const t = (params.t ?? 0) * speed * 10; // scale time for visible motion

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;

  const freq = 4 * scale;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Three overlapping sine waves — the classic plasma recipe
      const v1 = Math.sin(x / w * freq + t);
      const v2 = Math.sin(y / h * freq + t * 0.7);
      const v3 = Math.sin((x + y) / w * freq + t * 1.3);
      const v4 = Math.sin(Math.sqrt((x - w / 2) * (x - w / 2) + (y - h / 2) * (y - h / 2)) / w * freq * 2 + t * 0.5);

      // Sum and normalize to [0, 1]
      const sum = (v1 + v2 + v3 + v4) / 4; // in [-1, 1]
      const normalized = (sum + 1) / 2;    // in [0, 1]

      const [r, g, b] = pal(normalized);
      const off = (y * w + x) * 4;
      data[off]     = r;
      data[off + 1] = g;
      data[off + 2] = b;
      data[off + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}


// -- Bars -------------------------------------------------------------------

/**
 * Horizontal color bars with scroll.
 * Params: count (default 8), speed (default 1).
 */
function renderBars(ctx, w, h, params) {
  const count = Math.max(1, Math.floor(params.count ?? 8));
  const speed = params.speed ?? 1;
  const t = (params.t ?? 0) * speed;

  // Scroll offset in pixels
  const scrollY = t * h;

  const barHeight = h / count;

  for (let i = 0; i < count + 1; i++) {
    // Which color from the Spectrum palette?  Cycle through 1-7 (skip black).
    const colorIdx = ((i % 7) + 1);
    const [r, g, b] = SPEC_COLORS[colorIdx];

    // Compute bar vertical position with scroll wrapping
    const y0 = ((i * barHeight - scrollY) % h + h) % h;
    const y1 = y0 + barHeight;

    ctx.fillStyle = `rgb(${r},${g},${b})`;

    if (y1 <= h) {
      // Bar fits entirely on screen
      ctx.fillRect(0, y0, w, barHeight);
    } else {
      // Bar wraps around the bottom edge
      ctx.fillRect(0, y0, w, h - y0);
      ctx.fillRect(0, 0, w, y1 - h);
    }
  }
}


// -- Lissajous --------------------------------------------------------------

/**
 * Lissajous curve with trail.
 * Params: freqX (default 3), freqY (default 2), phase (default 0),
 *         trail (0-1, default 0.5, how much of the curve to draw).
 */
function renderLissajous(ctx, w, h, params) {
  const freqX = params.freqX ?? 3;
  const freqY = params.freqY ?? 2;
  const phase = params.phase ?? 0;
  const trail = clamp(params.trail ?? 0.5, 0, 1);
  const t = (params.t ?? 0) * Math.PI * 2;

  // Clear to black
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Draw the curve — use Spectrum bright green
  const steps = 500;
  const trailSteps = Math.max(2, Math.floor(steps * trail));

  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.beginPath();

  for (let i = 0; i <= trailSteps; i++) {
    const angle = t - (trailSteps - i) / steps * Math.PI * 2;
    const px = w / 2 + (w / 2 - 8) * Math.sin(freqX * angle + phase);
    const py = h / 2 + (h / 2 - 8) * Math.sin(freqY * angle);

    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }

  ctx.stroke();

  // Draw a bright dot at the current head position
  const headX = w / 2 + (w / 2 - 8) * Math.sin(freqX * t + phase);
  const headY = h / 2 + (h / 2 - 8) * Math.sin(freqY * t);
  ctx.fillStyle = '#00ff00';
  ctx.beginPath();
  ctx.arc(headX, headY, 3, 0, Math.PI * 2);
  ctx.fill();
}


// -- Starfield --------------------------------------------------------------

/** Persistent star data.  Lazily initialized on first render. */
let _stars = null;
let _starCount = 0;

/**
 * Simple 2D starfield (into the screen).
 * Params: speed (default 1), density (default 200).
 */
function renderStarfield(ctx, w, h, params) {
  const speed = params.speed ?? 1;
  const density = Math.max(10, Math.floor(params.density ?? 200));

  // (Re)initialize stars if count changed
  if (!_stars || _starCount !== density) {
    _starCount = density;
    _stars = [];
    for (let i = 0; i < density; i++) {
      _stars.push({
        x: Math.random() * 2 - 1,  // -1..1 (relative to center)
        y: Math.random() * 2 - 1,
        z: Math.random(),           // 0..1 depth
      });
    }
  }

  // Clear to black
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  // Amount to advance z this frame.  We treat params.t as cumulative time
  // but we need per-frame delta, so we use a small fixed step scaled by speed.
  const dz = 0.005 * speed;

  const cx = w / 2;
  const cy = h / 2;

  for (let i = 0; i < _stars.length; i++) {
    const star = _stars[i];

    // Move star closer
    star.z -= dz;

    // Respawn if behind camera
    if (star.z <= 0.001) {
      star.x = Math.random() * 2 - 1;
      star.y = Math.random() * 2 - 1;
      star.z = 1;
    }

    // Project to 2D
    const sx = cx + (star.x / star.z) * cx;
    const sy = cy + (star.y / star.z) * cy;

    // Off screen? Skip.
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

    // Size and brightness based on depth (closer = bigger and brighter)
    const brightness = Math.min(1, (1 - star.z) * 1.5);
    const size = Math.max(0.5, (1 - star.z) * 3);

    const gray = Math.floor(brightness * 255);
    ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
    ctx.fillRect(Math.floor(sx), Math.floor(sy), Math.ceil(size), Math.ceil(size));
  }
}


// ---------------------------------------------------------------------------
// 5. OverlayCompositor — blend prototype + Spectrum layers
// ---------------------------------------------------------------------------

export class OverlayCompositor {
  /**
   * @param {HTMLCanvasElement} outputCanvas  Final composited output
   */
  constructor(outputCanvas) {
    this.output = outputCanvas;
    this.ctx = outputCanvas.getContext('2d');
    this.width = 256;
    this.height = 192;

    outputCanvas.width = this.width;
    outputCanvas.height = this.height;

    /** @type {'prototype'|'spectrum'|'overlay'|'difference'|'side-by-side'} */
    this.mode = 'overlay';

    /** Blend factor for overlay mode (0 = all spectrum, 1 = all prototype). */
    this.alpha = 0.5;
  }

  /**
   * Composite a Spectrum screen capture and a prototype rendering.
   *
   * Both inputs should be 256x192 ImageData.  The result is drawn to
   * this.output.
   *
   * @param {ImageData} spectrumImageData   From the real Spectrum renderer
   * @param {ImageData} prototypeImageData  From PrototypeRenderer
   */
  compose(spectrumImageData, prototypeImageData) {
    const w = this.width;
    const h = this.height;
    const specData = spectrumImageData.data;
    const protoData = prototypeImageData.data;

    switch (this.mode) {

      case 'spectrum':
        this.ctx.putImageData(spectrumImageData, 0, 0);
        break;

      case 'prototype':
        this.ctx.putImageData(prototypeImageData, 0, 0);
        break;

      case 'overlay': {
        const out = this.ctx.createImageData(w, h);
        const dst = out.data;
        const a = this.alpha;
        const ia = 1 - a;
        for (let i = 0; i < dst.length; i += 4) {
          dst[i]     = Math.round(specData[i]     * ia + protoData[i]     * a);
          dst[i + 1] = Math.round(specData[i + 1] * ia + protoData[i + 1] * a);
          dst[i + 2] = Math.round(specData[i + 2] * ia + protoData[i + 2] * a);
          dst[i + 3] = 255;
        }
        this.ctx.putImageData(out, 0, 0);
        break;
      }

      case 'difference': {
        // |spec - proto| per channel.  Bright = large divergence.
        const out = this.ctx.createImageData(w, h);
        const dst = out.data;
        for (let i = 0; i < dst.length; i += 4) {
          dst[i]     = Math.abs(specData[i]     - protoData[i]);
          dst[i + 1] = Math.abs(specData[i + 1] - protoData[i + 1]);
          dst[i + 2] = Math.abs(specData[i + 2] - protoData[i + 2]);
          dst[i + 3] = 255;
        }
        this.ctx.putImageData(out, 0, 0);
        break;
      }

      case 'side-by-side': {
        // Left half = Spectrum, right half = prototype.
        // Split at x = 128 (middle of 256).
        const out = this.ctx.createImageData(w, h);
        const dst = out.data;
        const mid = w / 2;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const src = x < mid ? specData : protoData;
            dst[i]     = src[i];
            dst[i + 1] = src[i + 1];
            dst[i + 2] = src[i + 2];
            dst[i + 3] = 255;
          }
        }
        this.ctx.putImageData(out, 0, 0);
        break;
      }

      default:
        // Fallback: just show prototype
        this.ctx.putImageData(prototypeImageData, 0, 0);
        break;
    }
  }
}
