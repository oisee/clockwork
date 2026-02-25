# Clockwork — ZX Spectrum Demoscene Sync Editor

## Project Specification v0.1

### 1. What Is This?

**Clockwork** — web-based timeline/sync editor for ZX Spectrum demoscene productions. Connects music (AY-3-8910, PT3/PSG) to visual effects with frame-accurate synchronization.

**Core idea**: GNU Rocket, but aware of chiptune music structure (patterns, notes, drums, envelopes) — not just a beat grid.

### 2. Where Does It Live?

**Separate repository** (`clockwork` or `zx-sync`), referenced from the book project.

**Rationale:**

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Chapter tool (ch12) | Close to content | Too complex for a chapter, couples lifecycles | No |
| Appendix | Self-contained reference | Still tied to book releases | No |
| Subdirectory in antique-toy | Easy access | Pollutes book repo, wrong audience | No |
| **Separate repo** | Own lifecycle, community tool, reusable by any demo | Need to coordinate | **Yes** |

The book's ch12 teaches sync *concepts*. Clockwork is the *practical tool* — it has value beyond the book. Other demosceners (not just readers) should be able to use it. The "Antique Toy" demo uses it as first customer.

**Integration with book repo**: git submodule or just a link in README/ch12. The demo engine (`demo/src/engine.a80`) already has timeline + ring buffer architecture ready for Clockwork's exported sync data.

### 3. Problem Statement

Current ZX Spectrum demo sync workflow:

1. **Hand-code** frame numbers in assembly scene table → tedious, error-prone
2. **Video editor** (GABBA/diver4d approach: Luma Fusion) → visual but disconnected from code
3. **Guess and recompile** → most common, most painful

There is **no dedicated sync tool** for ZX Spectrum / retro platforms. GNU Rocket exists for PC demoscene but:
- Doesn't understand chiptune music structure (patterns, instruments, drums)
- Beat grid doesn't map to PT3/PSG frame-level events
- No AY register visualization
- No ZX-specific export (binary tables for Z80)

### 4. Precision Levels

Three tiers of sync precision, from rough to exact:

```
Level 0: Paper timing
  "Intro = 0-500, main = 500-2000, finale = 2000-3000"
  Tools: pen & paper, spreadsheet, any video editor
  Precision: ~seconds (±50 frames)

Level 1: Video editor workflow
  Record AY audio → import to video editor → mark sync points visually
  Export timecodes → convert to frame numbers
  Tools: Luma Fusion, DaVinci Resolve, Audacity
  Precision: ~0.5 sec (±25 frames)

Level 2: Clockwork (this project)
  Frame-accurate interactive editing tied to music events
  See every note, drum, pattern change on a timeline
  Place keyframes on parameter tracks, preview in real-time
  Tools: web browser
  Precision: 1 frame (20ms at 50Hz)
```

### 5. Architecture

#### 5.1 Pure Frontend (No Backend Required)

The simplest, most portable version is **100% client-side**:

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│                                              │
│  ┌──────────┐  ┌───────────┐  ┌──────────┐  │
│  │ PT3/PSG  │  │  ayumi-js │  │  Audio   │  │
│  │  Parser  │→ │  (AY emu) │→ │ Worklet  │→ 🔊
│  └────┬─────┘  └───────────┘  └──────────┘  │
│       │                                      │
│       ↓ register dump per frame              │
│  ┌──────────────────────────────────────┐    │
│  │         Timeline Editor              │    │
│  │  ┌─ waveform (wavesurfer.js) ──────┐│    │
│  │  ├─ pattern/row markers ───────────┤│    │
│  │  ├─ channel activity (A/B/C/noise) ┤│    │
│  │  ├─ drum/event detectors ──────────┤│    │
│  │  ├─ user sync tracks (keyframes) ──┤│    │
│  │  └─ effect parameter curves ───────┘│    │
│  └──────────────────────────────────────┘    │
│       │                                      │
│       ↓ export                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ JSON     │  │ .a80     │  │ binary   │   │
│  │ (debug)  │  │ (include)│  │ (table)  │   │
│  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────┘
```

**No server, no install, no dependencies.** Open `index.html` → drag-drop PT3/PSG file → edit → export.

#### 5.2 Optional Backend (for advanced features)

For heavier tasks, a Python backend can be added later:

- Convert TAP/TRD → extract music → PSG dump
- Run sjasmplus to assemble demo with exported sync data
- Launch mzx emulator for live preview
- Batch processing / CI integration

**Tech**: FastAPI or Flask, communicates via REST/WebSocket. But this is Phase 2+.

#### 5.3 Optional Rocket Compatibility

If the Clockwork editor speaks Rocket's WebSocket protocol (port 1338), then:
- Existing Rocket-enabled demos can connect
- Clockwork becomes a drop-in Rocket replacement with music awareness
- JS Rocket client library already exists

This is Phase 3 — nice to have, not essential.

### 6. Core Components

#### 6.1 Music Engine

| Component | Library | Purpose |
|-----------|---------|---------|
| AY emulation | ayumi-js (pure JS) | Sample-accurate sound generation |
| PT3 parser | Cowbell's PT3 backend or AYSir | Parse patterns, notes, instruments |
| PSG parser | Custom (~50 lines) | Parse register dumps |
| Audio output | AudioWorklet | Glitch-free playback off main thread |
| Waveform | wavesurfer.js | Visual waveform + regions + markers |

**Data flow**: PT3 file → parser → per-frame register writes → ayumi-js → AudioWorklet → speakers. Simultaneously, register writes are recorded as a PSG stream for the timeline.

#### 6.2 Music Analysis (automatic event detection)

From the per-frame AY register dump, detect:

| Event | Detection Method |
|-------|-----------------|
| **Drum hit** | Noise period change (R6) + volume spike (R8-R10) + mixer noise enable (R7) |
| **Note onset** | Tone period change (R0-R5) with volume > 0 |
| **Pattern boundary** | PT3 parser reports pattern/row number per frame |
| **Envelope trigger** | R13 write (envelope shape register) |
| **Silence** | All volumes = 0 |
| **Bass note** | Channel with lowest tone period |
| **Buzz-bass** | Envelope mode on (R8-R10 bit 4) + specific period alignment |

These detected events appear as **markers on the timeline** — user can snap sync keyframes to them.

#### 6.3 Timeline Editor

Two candidates for the canvas timeline:

1. **animation-timeline-js** — zero-dep TypeScript, canvas-based keyframe editor with snap, zoom, drag. Best fit.
2. **Custom canvas** — full control but more work.

**Timeline rows (top to bottom):**

```
┌─ Audio waveform (wavesurfer.js) ──────────────────────┐
├─ Pattern │ 0  │ 1  │ 2  │ 3  │ 4  │ 5  │ ...        │  ← from PT3
├─ Row     │0..63│0..63│0..63│                           │  ← PT3 row counter
├─ Ch.A ♪  │▃▃▅▇▇▅▃▃│▃▃▅▇▇▅▃▃│                          │  ← volume envelope
├─ Ch.B ♪  │    ▅▇▅  │    ▅▇▅  │                         │
├─ Ch.C ♪  │▇▇▇▇▇▇▇▇│▇▇▇▇▇▇▇▇│                         │  ← bass line
├─ Noise 🥁│  ▏  ▏   │  ▏  ▏   │                         │  ← detected drums
├─ Envelope │ ╱╲    │  ╱╲   │                             │
├─────────────────────────────────────────────────────────┤
├─ effect_id  │ plasma=0 ████│ torus=1 ████████│ plasma ██│  ← user track
├─ fade       │╲▁▁▁▁▁▁▁▁▁▁▁▁│▁▁▁▁▁▁▁▁▁▁▁▁╱╲▁│          │  ← user track
├─ rotate_spd │▁▁▁▁▁╱▔▔▔▔▔╲▁│▁▁╱▔▔▔▔▔▔▔▔▔▔▔▔│          │  ← user track
├─ palette    │ 0           │ 1    ▏  2       │ 0        │  ← user track (step)
└─────────────────────────────────────────────────────────┘
  frame: 0    100   200   300   400   500   600   700
```

**Top half**: read-only music analysis (auto-generated from PSG data).
**Bottom half**: user-editable sync tracks with keyframes.

#### 6.4 Sync Tracks (user-defined parameters)

Each track is a named float channel with keyframes:

```javascript
{
  name: "effect_id",       // track name (hierarchical: "scene:effect_id")
  type: "step",            // interpolation default for this track
  keyframes: [
    { frame: 0,   value: 0, interp: "step" },    // plasma
    { frame: 200, value: 1, interp: "step" },    // torus
    { frame: 450, value: 0, interp: "step" },    // plasma again
  ]
}
```

**Interpolation modes** (same as Rocket):
- **step**: constant until next keyframe
- **linear**: linear interpolation
- **smooth**: smoothstep (Hermite)
- **ramp**: quadratic ease-in

#### 6.5 Effect Registry & Scene Mapping

Each demo effect is registered with its source, build command, and mzx capture config:

```json
{
  "effects": [
    {
      "id": "plasma",
      "name": "Attribute Plasma",
      "source": "chapters/ch09-tunnels/examples/plasma.a80",
      "build": "sjasmplus --nologo --raw=${bin} --sym=${sym} ${source}",
      "entry": "0x8000",
      "params": {
        "speed": { "addr": "speed", "type": "u8", "default": 3, "range": [1, 10] },
        "palette": { "addr": "palette_id", "type": "u8", "default": 0, "range": [0, 3] }
      },
      "mzx": {
        "model": "48k",
        "args": "--run ${bin}@8000",
        "frames": 100,
        "border": false
      }
    },
    {
      "id": "torus",
      "name": "Wireframe Torus",
      "source": "demo/src/torus.a80",
      "build": "cd demo/src && sjasmplus --nologo --raw=${bin} torus.a80",
      "entry": "0x8000",
      "params": {
        "rot_speed": { "addr": "rotation_step", "type": "u8", "default": 2 }
      },
      "mzx": {
        "model": "48k",
        "args": "--run ${bin}@8000",
        "frames": 200,
        "border": false
      }
    }
  ]
}
```

**Scenes on the timeline** reference effects with parameter overrides:

```
Scene @ frame 0-200:   effect="plasma", speed=3, palette=0
Scene @ frame 200-450: effect="torus",  rot_speed=4
Scene @ frame 450-700: effect="plasma", speed=7, palette=2
```

**Parameter injection** (how values reach the Z80 code):

| Method | How | Pros | Cons |
|--------|-----|------|------|
| **Symbol patching** | sjasmplus `--sym` exports labels → patch binary at symbol address | Clean, uses existing labels | Need symbol file per build |
| **mzx --load + --set** | `--load bin@8000 --set MEM[8100]=03` | No recompile needed | mzx must support MEM[] syntax |
| **Fixed param block** | Convention: params always at `$8100` | Simple, predictable | Rigid |
| **Pre-baked binaries** | Compile once per param combo | Guaranteed correct | Combinatorial explosion |

Recommended: **symbol patching** (Phase 3) with **fixed param block** as fallback (Phase 1).

**Preview workflow:**
1. User places scene on timeline (click + drag)
2. Clockwork compiles .a80 → .bin (calls sjasmplus)
3. Patches parameters into .bin at symbol addresses
4. Runs `mzx --run patched.bin@8000 --frames N --screenshot frame.png`
5. Displays captured frame as thumbnail on the timeline
6. User can scrub through a scene and see different frames

This requires a **local backend** (Python/Node) for Phase 3+ — browser can't run sjasmplus/mzx directly. Phase 0-2 are pure frontend.

#### 6.6 Scene Source Types & Render Pipeline

Regardless of how a scene is produced, the output is always the same: **a sequence of ZX Spectrum screens** (6912 bytes each, or 256×192 pixel buffers). Sources vary; the pipeline normalizes them.

**Source types:**

| Type | Input | How | When to use |
|------|-------|-----|-------------|
| **Screenshot catalog** | Directory of `.scr` / `.png` | Link path → indexed by frame offset | Pre-rendered effects, hand-drawn frames, imported from other tools |
| **Binary + mzx** | `.a80` source → `.bin` | Compile → `mzx --run bin@8000 --frames N` → capture `.scr` per frame | Z80 effects with parameter injection |
| **mzx script** | Batch file with param sequences | `mzx --batch script.mzx` | Complex capture scenarios, multi-pass |
| **JS/WebGL prototype** | Canvas/WebGL code in browser | Render to 256×192 canvas, quantize to Spectrum palette | Instant preview, prototyping, no backend needed |

```
Source A (catalog)  ──→ [scr_000.scr, scr_001.scr, ...]  ─┐
Source B (mzx)      ──→ [scr_000.scr, scr_001.scr, ...]  ─┤
Source C (JS/WebGL) ──→ [pixel buffer, pixel buffer, ...]  ─┤
                                                            ↓
                                              Unified Screen Sequence
                                                            ↓
                                              ┌─ Filter Track ─────┐
                                              │ gigascreen, fade,  │
                                              │ flash, invert ...  │
                                              └────────────────────┘
                                                            ↓
                                              Preview / Export / Filmstrip
```

**JS/WebGL prototype layer:**

The browser can render Spectrum-resolution effects directly (256×192 canvas, Spectrum palette). This gives instant visual feedback without compiling Z80 or running mzx. Use cases:
- Quick plasma/tunnel/rotozoomer prototypes in JS before writing Z80
- Parameter scrubbing at 60fps (impossible with mzx capture)
- "Draft" visuals while real Z80 code is being developed
- Effect previews in the timeline (thumbnails rendered client-side)

The prototype layer renders to the same screen format, so it can be swapped for the "real" mzx-captured frames later without changing the timeline structure.

**Bidirectional data flow (JS/WebGL ↔ timeline):**

The prototype layer is not just a renderer — it can also be a **source of parameter data**. Example:

```
Timeline → JS/WebGL:  parameter tracks drive rendering (scrub speed, palette, rotation)
JS/WebGL → Timeline:  extract computed values back into tracks (polygon coords, colors)
```

Use case: a 3D torus prototype in WebGL computes vertex positions per frame. Those XY coordinates can be captured as keyframe tracks and exported as Z80 lookup tables. Similarly, a procedural palette generator can export its per-frame color values.

This turns the JS prototype into an **animation authoring tool**: design motion in the browser, capture the parameters, export to Z80 as pre-computed tables. The Z80 code doesn't need to compute the same math — it just reads from a table.

**Render filters (per-range):**

Filters are applied as a **track on the timeline** — enabled/disabled per frame range:

```
Frame source: [scr_001] [scr_002] [scr_003] [scr_004] [scr_005] ...
Filter track: |------- gigascreen ON ---------|-- normal --|-- fade out --|
```

| Filter | What it does | Spectrum relevance |
|--------|-------------|-------------------|
| **Gigascreen** | Blend frame N and frame N+1 → 102 effective colors | Classic ZX technique, alternating frames at 50Hz |
| **Fade to black** | Progressively darken attributes | Scene transitions |
| **Flash/strobe** | Alternate bright/normal attributes | Drum sync |
| **Invert** | XOR $FF on pixel data | Glitch effect |
| **Border color** | Set border per frame (not in .scr, separate track) | Screen-independent |

Gigascreen is the most important: it mixes two adjacent screens by combining their attribute colors, producing up to 102 unique colors from the Spectrum's 15. On real hardware this works because the CRT phosphor blends two alternating frames at 50Hz. In Clockwork, the preview just alpha-blends the two frames.

Filters are **non-destructive** — original screen data is preserved, filters are applied at display/export time. A single screen sequence can have different filters in different ranges.

#### 6.7 Event Triggers (music → demo)

User defines trigger rules:

```javascript
{
  name: "flash_on_drum",
  source: "drum_hit",           // detected event type
  channel: "noise",             // which channel to watch
  action: "set",                // set a sync track value
  target_track: "flash",        // which track to modify
  value: 1,                     // value to set
  decay: { frames: 4, to: 0 }, // auto-decay back to 0 over 4 frames
}
```

This lets the demo **react to music** without manually placing keyframes on every drum hit.

#### 6.8 Export Formats

**a) JSON** (for debugging and round-tripping):
```json
{
  "version": 1,
  "music": "demo_tune.pt3",
  "bpm_hint": 125,
  "total_frames": 8000,
  "tracks": [ ... ],
  "triggers": [ ... ]
}
```

**b) Z80 assembly include** (for the demo):
```z80
; Generated by Clockwork — do not edit
; Music: demo_tune.pt3 (8000 frames, 160 sec)

SCENE_COUNT EQU 5

scene_table:
    ; effect_id, duration (frames), param_ptr
    DB 0 : DW 200 : DW params_0    ; plasma
    DB 1 : DW 250 : DW params_1    ; torus
    DB 0 : DW 200 : DW params_2    ; plasma (variant)
    DB 1 : DW 350 : DW params_3    ; torus (fast)
    DB $FF                          ; end marker

; Per-frame parameter table for tracks that need it
; (only keyframe changes stored, not every frame)
params_0:
    DB 0     ; fade=0, rotate_spd=0, palette=0
params_1:
    DB 128   ; fade=0, rotate_spd=128, palette=1
; ...

; Drum trigger table (frames where drum_hit detected)
drum_frames:
    DW 47, 95, 143, 191, 239, ...
    DW $FFFF  ; end marker
```

**c) Binary table** (compact, for memory-constrained demos):
```
Header: 4 bytes ("CWRK")
Track count: 1 byte
Per track:
  Name length: 1 byte
  Name: N bytes
  Keyframe count: 2 bytes (LE)
  Per keyframe:
    Frame: 2 bytes (LE)
    Value: 2 bytes (LE, fixed-point 8.8)
    Interpolation: 1 byte
```

#### 6.9 Prototyping Layer (Motion Design)

The JS/WebGL layer (§6.6) is more than a preview renderer — it is a **motion-design authoring environment**, closer to Cavalry or After Effects expressions than to a simple canvas. You design parametric animations at full fidelity, then push them down to the ZX Spectrum's 256×192 attribute grid. The creative work happens in the browser; Z80 just plays back pre-computed data.

##### 6.9.1 Parametric Formula Engine

Every sync track (§6.4) can carry a **per-frame expression** instead of (or in addition to) manually placed keyframes. The expression is evaluated once per frame and writes the result into the track.

**Available variables:**

| Variable | Type | Meaning |
|----------|------|---------|
| `t` | float 0..1 | Normalized time within the current scene |
| `frame` | int | Absolute frame number from start of project |
| `beat` | float | Fractional beat counter (derived from BPM) |
| `bpm` | float | Current tempo (from PT3 speed or user override) |

**Built-in functions:**

| Category | Functions |
|----------|-----------|
| Trig | `sin`, `cos`, `atan2`, `PI`, `TAU` |
| Interpolation | `lerp(a, b, t)`, `smoothstep(edge0, edge1, t)`, `clamp(x, lo, hi)` |
| Easing | `easeInOut(t)`, `easeIn(t)`, `easeOut(t)` |
| Bounce / spring | `bounce(t)`, `elastic(t, amplitude, period)` |
| Noise | `noise(x)`, `noise2d(x, y)` (Simplex) |
| Utility | `abs`, `floor`, `ceil`, `fract`, `mod`, `sign`, `step` |

**Example expressions:**

```javascript
// Bouncing horizontal path: 4 full oscillations across the scene
x = 128 + 80 * sin(t * PI * 4)

// Fade-in over first 10% of scene, hold, fade-out over last 10%
alpha = smoothstep(0, 0.1, t) * (1 - smoothstep(0.9, 1.0, t))

// Pulse on every beat
pulse = abs(sin(beat * PI))

// Elastic settle: overshoot then converge
y = 96 + 40 * elastic(t, 1.2, 0.3)
```

**Composability**: expressions can reference other tracks by name. The evaluation order is topologically sorted — if track `radius` references track `speed`, then `speed` is evaluated first.

```javascript
// Track "speed":  lerp(1, 8, t)
// Track "angle":  angle + speed * 0.02          // integrates speed
// Track "x":      128 + radius * cos(angle)
// Track "y":       96 + radius * sin(angle)
```

This is equivalent to After Effects expressions or Cavalry's formula nodes — except the target canvas is 256×192 and the output can be exported as Z80 lookup tables.

##### 6.9.2 Spectrum Overlay Mode

When prototyping an effect in JS/WebGL, you often want to compare the "ideal" full-color render against the actual ZX Spectrum output (from mzx captures or `.scr` files). The overlay stack makes this a single toggle:

```
Layer 3: UI overlay (cursor, guides, grid)
Layer 2: Prototype render (JS/WebGL, full-color)
Layer 1: Spectrum screen (.scr, attribute-constrained)
Layer 0: Background (dark canvas)

Composite: selectable blend mode (overlay, difference, side-by-side, split)
```

**Display modes** (keyboard shortcut cycles through):

| Mode | What you see | Use case |
|------|-------------|----------|
| **Prototype only** | Full-color JS/WebGL output at 256×192 | Design without hardware constraints |
| **Spectrum only** | Attribute-constrained `.scr` frame | Final output verification |
| **Overlay** | Both layers composited, adjustable alpha | Spot divergence between ideal and real |
| **Difference** | `abs(prototype - spectrum)` per pixel | Quantify error — bright = large mismatch |
| **Side-by-side** | Left: prototype, Right: spectrum | Quick A/B comparison |
| **Split** | Draggable vertical divider | Pixel-level comparison at boundary |

**Workflow**: design a plasma in JS → overlay it on the Z80-rendered plasma captured by mzx → see exactly where the attribute grid causes banding, where colors collapse, where motion diverges. Adjust JS parameters until the prototype closely matches what the hardware can actually produce — then export the parameters as Z80 tables.

##### 6.9.3 Attribute Filter (Spectrum Quantizer)

Any RGB image (from the prototype layer, a screenshot, or an imported PNG) can be passed through the **Spectrum Quantizer** to see what it would look like on real ZX Spectrum hardware.

**ZX Spectrum attribute constraints:**

```
Screen resolution:  256 × 192 pixels
Cell grid:          32 × 24 cells (each 8×8 pixels)
Colors per cell:    2 (ink + paper)
Palette:            15 colors (8 normal + 7 bright; black = black)
Pixel depth:        1 bit per pixel within each cell
```

**Quantization algorithm (per 8×8 cell):**

```
For each cell (8×8 pixels):
  1. Collect all 64 RGB pixel values
  2. Pick the best (ink, paper) pair from the Spectrum palette
  3. Assign each pixel to ink or paper (nearest color)
  4. Store: 8 bytes pixel data + 1 byte attribute
```

**The 15-color Spectrum palette:**

| Index | Normal | Bright |
|-------|--------|--------|
| 0 | Black `#000000` | — (same) |
| 1 | Blue `#0000CD` | `#0000FF` |
| 2 | Red `#CD0000` | `#FF0000` |
| 3 | Magenta `#CD00CD` | `#FF00FF` |
| 4 | Green `#00CD00` | `#00FF00` |
| 5 | Cyan `#00CDCD` | `#00FFFF` |
| 6 | Yellow `#CDCD00` | `#FFFF00` |
| 7 | White `#CDCDCD` | `#FFFFFF` |

The quantizer applies the filter in real-time as the user scrubs the timeline — every prototype frame is shown both "ideal" and "Spectrum-ified" simultaneously (via overlay mode, §6.9.2).

##### 6.9.4 Auto-Diver: Optimal Attribute Assignment

The naive quantizer (§6.9.3) picks ink/paper per cell independently. The **Auto-Diver** does it optimally: for each 8×8 cell, brute-force all possible attribute combinations and pick the one that minimizes pixel error.

**Combinatorics:**

```
15 colors → C(15,2) + 15 = 105 + 15 = 120 ink/paper pairs
  (but ink=paper is useless for most cells, so effectively 105)
× 768 cells per screen
= 80,640 evaluations per frame (trivial at JS speed)
```

**Error metric (per cell):**

```
For a candidate (ink_rgb, paper_rgb):
  error = 0
  For each of the 64 pixels in the cell:
    d_ink   = (r - ink_r)² + (g - ink_g)² + (b - ink_b)²
    d_paper = (r - paper_r)² + (g - paper_g)² + (b - paper_b)²
    pixel_bit = (d_ink < d_paper) ? 1 : 0
    error += min(d_ink, d_paper)
  Total cell error = error
```

**Tax metric**: the sum of cell errors across all 768 cells gives a single number — the "color tax" of Spectrum quantization. Lower is better. Useful for comparing effect variants: "this palette has tax 1.2M, that one has 0.8M — use the second."

**Temporal coherence (animation mode):**

For animations, the Auto-Diver can add a **flicker penalty** to the error metric:

```
cell_cost = pixel_error + λ * attribute_changed(prev_frame)
```

Where `λ` weights the cost of changing a cell's attribute between consecutive frames. High `λ` = stable attributes (less flicker), at the cost of worse per-frame color accuracy. This prevents the "attribute shimmer" problem where optimal per-frame assignment causes distracting flickering.

**Dithering extensions:**

Within the 1-bit-per-pixel constraint, dithering can improve perceived quality:

| Method | Description | Best for |
|--------|-------------|----------|
| **None** | Nearest-color threshold | Hard edges, text, geometric patterns |
| **Ordered (Bayer 4×4)** | Fixed threshold pattern within cell | Gradients, smooth shading |
| **Floyd-Steinberg (cell-local)** | Error diffusion within 8×8 cell boundary | Photographic images, complex scenes |
| **Atkinson** | Modified FS, diffuses only 6/8 of error | Lighter look, classic Mac aesthetic |

Dithering is applied **within each cell independently** — error does not cross cell boundaries (because ink/paper changes at cell edges).

##### 6.9.5 Prototype → Z80 Pipeline

Two paths from prototype to playable demo:

```
Path A: Parameter Export
┌───────────────┐    ┌──────────────────┐    ┌──────────────┐
│  JS Prototype  │ →  │ Extract per-frame │ →  │ Z80 lookup   │
│  (motion design)│    │ parameter values  │    │ tables (.a80)│
└───────────────┘    └──────────────────┘    └──────────────┘
  Design curves,       x[0]=128, x[1]=134,    DB 128, 134,
  tweak formulas       x[2]=146, ...           146, ...

Path B: Screen Export
┌───────────────┐    ┌──────────────────┐    ┌──────────────┐
│  JS Prototype  │ →  │ Attribute Quantize │ →  │ .scr sequence│
│  (full-color)  │    │ (Auto-Diver)       │    │ (6912 B each)│
└───────────────┘    └──────────────────┘    └──────────────┘
  Render 256×192       Apply §6.9.4           Ready for Z80
  RGB frames           constraints            playback engine
```

**Path A** is for effects where Z80 computes the visuals but needs motion data (rotation angles, positions, palette indices). The JS prototype designs the motion; Z80 code uses the exported tables as input.

**Path B** is for effects where the entire screen is pre-rendered. The JS prototype produces the frames; the Auto-Diver quantizes them; Z80 code just streams `.scr` data to VRAM. This is how full-screen video effects (plasma, tunnel, rotozoomer) can be prototyped rapidly and then baked for playback.

**Export formats:**

| Format | Content | Size per frame | Use case |
|--------|---------|---------------|----------|
| `.a80` lookup table | `DB` values for N parameters | N bytes | Path A — parameter playback |
| `.scr` sequence | 6912-byte Spectrum screens | 6912 bytes | Path B — screen streaming |
| `.bin` packed | Delta-compressed `.scr` sequence | Variable | Path B — memory-constrained |
| JSON keyframes | Frame→value pairs per track | — | Round-trip back to Clockwork |

The creative work — choosing curves, adjusting timing, tuning palettes — happens in the browser at 60fps. The Z80 code is a playback engine that reads pre-computed data. This separation means the motion design can be iterated without touching Z80 assembly.

### 7. User Workflow

```
1. Open Clockwork in browser
2. Drag-drop PT3 or PSG file
   → music loads, waveform appears, patterns/notes visualized
3. Press Play — hear music, see playback cursor move
4. Add sync tracks: "effect_id", "fade", "palette", etc.
5. Click on timeline to place keyframes
   → snap to detected drums, pattern boundaries, notes
6. Define trigger rules: "on every drum hit, flash=1 for 4 frames"
7. Preview: see parameter curves animate in real-time with music
8. Export → .a80 include file for demo engine
9. Assemble demo, run in emulator, verify sync
10. Iterate: adjust keyframes, re-export, re-test
```

### 8. Tech Stack

| Layer | Technology | Size | Notes |
|-------|-----------|------|-------|
| **AY emulation** | ayumi-js | ~8 KB | Pure JS port of ayumi |
| **PT3 parsing** | Custom or Cowbell backend | ~15 KB | Extract patterns/notes/instruments |
| **PSG parsing** | Custom | ~2 KB | Trivial format |
| **Audio output** | AudioWorklet | ~3 KB | Modern, off-thread |
| **Waveform** | wavesurfer.js v7 | ~15 KB | Regions + markers |
| **Timeline** | animation-timeline-js | ~30 KB | Canvas keyframe editor |
| **UI framework** | Vanilla JS + CSS | — | No framework needed |
| **Export** | Custom | ~5 KB | JSON + .a80 + binary |
| **Total** | | ~80 KB | No build step needed |

**No npm, no webpack, no React.** ES modules + `<script type="module">`. Open `index.html` and it works.

### 9. Phased Development

#### Phase 0: PSG Viewer (MVP) — IN PROGRESS
**Done:**
- [x] Load PSG file (drag-drop or file picker)
- [x] Binary PSG parser (header "PSG" + 0x1A)
- [x] Text PSG parser (zxtune123 "# PSG Dump" format)
- [x] ayumi AudioWorklet (AY-3-8910 emulation, from AYSir)
- [x] Canvas timeline: volume bars (A/B/C), tone/noise/envelope indicators
- [x] Drum hit detection + markers (triangles)
- [x] Playback with audio-clock sync at 50 Hz
- [x] Scroll (mouse wheel zoom), click-to-seek, keyboard shortcuts
- [x] GainNode fade-in/out (anti-click)
- [x] ResizeObserver for proper canvas init

**TODO (Phase 0+):**
- [ ] **Pitch overlay** on volume bars — show detected note names (C4, D#5...) using AY period→note mapping. Switchable modes: volume-only / pitch-only / combined
- [ ] **Tuning table auto-detection** — match periods against standard tables (equal temperament, Vortex Tracker tables, Ivan Roshin natural tuning). User can switch/override.
- [ ] **Pre-render PSG → WAV** — offline AudioContext renders entire file; enables instant seek, waveform overview (wavesurfer.js), and WAV export button
- [ ] **Display modes** — switchable: register bars / piano roll / combined
- [ ] Note name labels on tone rows when zoomed in
- [ ] Tooltip on hover: frame number, register values, detected note
- [ ] Fix Safari compatibility (AudioWorklet support check, ScriptProcessorNode fallback?)

**Value**: immediately useful for debugging AY music, even without sync editing.

#### Phase 1: Sync Track Editor
- Add user-defined parameter tracks below the music visualization
- Keyframe placement with snap-to-event (drums, pattern boundaries, notes)
- Step/linear/smooth/ramp interpolation
- JSON export/import (`.clockwork` project files)
- Scene/subscene timeline — group keyframes into named sections
- **Value**: replaces hand-coded scene tables

#### Phase 2: Music-Aware Triggers
- Drum detection, note onset detection (already started in Phase 0)
- Trigger rules (drum → flash, pattern change → effect switch)
- Auto-generated keyframes from triggers
- **Value**: reactive demos without manual keyframe placement

#### Phase 3: Z80 Export
- Generate .a80 include files matching Antique Toy's engine format
- Binary table export for custom engines
- Scene table + parameter tables + event tables
- **Value**: closes the loop — edit in browser, export to demo

#### Phase 4: Live Preview + Video Sync
- **mzx frame rendering**: pre-render demo frames via mzx, display as synced filmstrip/video alongside timeline
- **Video + audio sync**: scrub through both simultaneously
- WebSocket connection to mzx emulator (if mzx gains a remote API)
- Or: Rocket protocol compatibility (port 1338)
- Or: built-in ZX Spectrum screen renderer (canvas, using register dumps)
- **Value**: see the actual demo while editing sync

### 10. File Format: `.clockwork`

Project file = JSON with embedded or referenced music:

```json
{
  "clockwork_version": 1,
  "project_name": "Antique Toy",
  "music": {
    "file": "demo_tune.pt3",
    "format": "pt3",
    "total_frames": 8000,
    "speed": 3,
    "highlight": 16
  },
  "detected_events": {
    "drums": [47, 95, 143, ...],
    "pattern_boundaries": [0, 192, 384, ...],
    "notes": { "A": [...], "B": [...], "C": [...] }
  },
  "tracks": [
    {
      "name": "effect_id",
      "color": "#ff6600",
      "default_interp": "step",
      "keyframes": [
        { "frame": 0, "value": 0 },
        { "frame": 200, "value": 1 }
      ]
    }
  ],
  "triggers": [
    {
      "name": "flash_on_drum",
      "source": "drum_hit",
      "target": "flash",
      "value": 1,
      "decay": 4
    }
  ],
  "export": {
    "format": "a80",
    "engine": "antique_toy",
    "scene_table_label": "scene_table"
  }
}
```

### 11. Relationship to Book Content

| Book Section | Clockwork Connection |
|---|---|
| **Ch.11 (Sound)** | AY register map = what Clockwork visualizes |
| **Ch.12 (Music Sync)** | Concepts implemented by Clockwork (ring buffer, scripting, GABBA's workflow) |
| **Ch.12.4 (GABBA's method)** | Clockwork replaces the video editor step with a purpose-built tool |
| **Ch.20 (Demo Workflow)** | Scene table format = Clockwork's export target |
| **Appendix** | "Using Clockwork" tutorial (2-3 pages) linking to the tool |
| **Demo (Antique Toy)** | First customer — `demo/src/tables.a80` generated by Clockwork |

### 12. Prior Art Comparison

| Feature | GNU Rocket | Clockwork | Video Editor |
|---------|-----------|-----------|-------------|
| Beat grid | BPM-based | Frame + music-event aware | Manual markers |
| Music understanding | None (just BPM) | Full (patterns, notes, drums) | Waveform only |
| AY register view | No | Yes | No |
| Keyframe editing | Yes (float tracks) | Yes (float tracks) | Sort of (markers) |
| Interpolation | 4 modes | 4 modes (same) | N/A |
| Trigger rules | No | Yes (drum→flash) | No |
| Z80 export | No | Yes (.a80, binary) | No (timecodes) |
| Live demo connection | TCP socket | Phase 4 (WebSocket) | None |
| Platform | Desktop (Qt) | Browser | Desktop |
| Install | Compile C++ | Open HTML | Heavy app |
| ZX Spectrum aware | No | Yes | No |

### 13. Open Questions

1. **Name**: "Clockwork" fits the Antique Toy aesthetic (clockwork mechanism = precise timing). Alternatives: "zx-sync", "spectrack", "AY-sync". What do we prefer?

2. **PT3 parsing depth**: Do we parse PT3 natively in JS (complex: effects, ornaments, samples) or shell out to a conversion tool (pt3-to-psg) and work with PSG only? PSG-only is simpler but loses pattern/row structure.

3. **TurboSound**: Support 2xAY from day one or add later? (AYSir has dual-chip support in development.)

4. **Rocket compatibility**: Worth the protocol overhead? Or just export Rocket-compatible track files for offline use?

5. **Scope boundary**: Where does Clockwork end and the demo engine begin? Clockwork exports data; the demo engine consumes it. Clear interface = scene table + parameter tables.

### 14. Success Criteria

**Phase 0 is successful when**: you can load a PSG file, see register activity per frame on a timeline, hear the music, and identify drum hits visually.

**Phase 1 is successful when**: you can place keyframes on sync tracks, snap them to detected events, and export a JSON that round-trips perfectly.

**Phase 3 is successful when**: the Antique Toy demo's `tables.a80` is generated by Clockwork, the demo assembles and runs with correct effect timing.

**The project is successful when**: a demoscener who has never used it can load their PT3, define sync in 15 minutes, and export a working scene table.
