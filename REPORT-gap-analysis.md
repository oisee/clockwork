# Clockwork Gap Analysis & Design Ideas

## Date: 2026-03-02

---

## 1. Appendix J vs. Clockwork — Feature Gaps

Source: ~/dev/antique-toy/appendices/appendix-j-modern-tools.md

| Feature | Appendix J Reference | Clockwork Status |
|---|---|---|
| Keyframe tracks + interpolation | GNU Rocket (step/linear/smooth/ramp) | Missing |
| Curve editor | Blender Graph Editor (J.2) | Missing |
| Sync markers | Blender VSE named markers → `dw frame ; name` | **Implemented** — MarkerManager with layers, JSON + ASM export |
| Waveform display | Blender VSE audio waveform | Missing (register bars only; pattern grid added) |
| Z80 export | Recipe 1: bake → `db`/`dw` tables | **Partial** — ASM `dw` frame tables via marker export |
| Snap-to-beat/grid | All sync tools | Missing |
| Undo/redo | Standard everywhere | Missing |
| Rocket protocol | GNU Rocket TCP live editing | Missing |

---

## 2. n1k-o's Excel Workflow (Ch.12 §12.4 — GABBA demo)

Source: ~/dev/antique-toy/chapters/ch12-music-sync/draft.md

n1k-o exported Vortex Tracker data into Excel: colour-coded visual map
where every row = one pattern row (NOT one frame — at Speed=4, each row
spans 4 frames at 50Hz). Columns per musical layer: kick=blue, snare=red,
melody=green, acid=purple. Extra columns for frame numbers + sync data.

**Key insight:** Coders heard gabber as a wall of sound — the spreadsheet
made musical structure visible. Adopted for all subsequent demos.

**Row-to-frame mapping:** `absolute_frame = pattern_start_frame + (row_index × speed)`
where speed is the VT2/PT3 Speed value (typically 3-6). Speed can change
mid-song via effect commands.

---

## 3. Import Formats Available

### VT2 (Vortex Tracker 2 text format)
- Sections: [Module], [Sample1-31], [Ornament1-15], [Pattern0-N]
- PlayOrder: comma-separated pattern indices, "L" prefix = loop point
- Per row: 3 channels (A/B/C) + envelope + noise globals
- Cell: Note (C-1..B-8), Sample ID, Ornament, Volume (0-F), Effects
- **Existing parser:** ~/dev/bitphase/src/lib/services/file/vt-converter.ts (1,163 lines)
- **PT3→VT2:** ~/dev/bitphase/src/lib/services/file/pt3-to-vt2.ts (551 lines)

### Bitphase (.btp = gzip JSON)
- Project { name, author, songs[], patternOrder[], instruments[], tables[] }
- Song: patterns[], chipType, chipFrequency, interruptFrequency
- Pattern: channels[A,B,C], patternRows[] (envelope, noise globals)
- Row: note{name, octave}, instrument, volume(0-15), effects[]
- **Existing code:** ~/dev/bitphase/src/lib/services/file/file-import.ts

### PSG (current, already supported)
- Pre-rendered register snapshots: 14 bytes × N frames
- No musical structure — just hardware state per frame
- Binary (.psg) and text (zxtune123) formats

---

## 4. Why Bitphase Playback Is Fast, Clockwork Is Slow

### Clockwork architecture (SLOW):
```
Main Thread (RAF 50Hz) → postMessage("regs", [...14 bytes...]) → AudioWorklet
```
- **Push-based**: main thread drives timing via requestAnimationFrame
- Worklet is dumb — just synthesises samples from static register state
- Seeking = pause + send single frame + resume (no state catch-up)
- 50Hz RAF jitter → audio timing inconsistencies
- Inter-thread postMessage latency adds up

### Bitphase architecture (FAST):
```
AudioWorklet.process() → patternProcessor → effectProcessor → ayumiEngine (WASM)
```
- **Pull-based**: AudioWorklet owns ALL timing
- Full pattern engine runs INSIDE the worklet (patterns, instruments, effects,
  slides, vibrato, arpeggio, envelope — everything)
- Sample-accurate tick accumulator: `tickAccumulator += tickStep; if >= 1.0 → process row`
- Delta-only register updates (only writes changed registers to WASM)
- Seeking: pre-computes "catch-up segments" simulating all rows from start to
  target position → correct instrument/effect state at any seek point
- Zero main-thread dependency during playback

### Bitphase rendering (responsive UI):
- **Single canvas** for pattern grid (no DOM per row)
- **Visible-rows-only rendering** with smart viewport calculation
- **3-tier caching**: row string cache (500), cell positions cache (500),
  visible rows cache, pattern cache (100)
- **Ring buffer oscilloscopes**: 512-sample frames, 1536-sample display buffer
- **RAF-gated redraws**: only when state actually changed
- **Skips hidden tabs**: checks document.hidden

### What Clockwork should adopt:
1. Move pattern/register logic INTO the AudioWorklet (pull-based)
2. Use catch-up segment seeking from bitphase
3. Delta-only register updates
4. OR: directly reuse bitphase's ayumi-processor.js + ayumi-engine.js

---

## 5. Design Ideas: Dual-Mode Timeline

### Mode A: PSG Signal Strip (overview/scrubber)
- Vertical orientation: 1-2 pixels per frame, scrollable
- Shows full PSG signal as colour-coded pixel columns
- Compact overview of entire song (e.g., 15000 frames × 2px = 30000px scroll)
- Click to seek, drag to scrub
- Colour mapping:
  - Channel A volume = green intensity
  - Channel B volume = blue intensity
  - Channel C volume = orange intensity
  - Noise = red overlay
  - Envelope triggers = purple markers

### Mode B: Timeline Editor (clip/arrange)
- Horizontal DAW-style layout
- Clip/cut/paste PSG segments as blocks
- Rearrange clips on the timeline, replay them
- Each clip = a range of PSG frames with metadata
- Multiple layers for different data types

### Mode C: Pattern Grid (n1k-o Excel view)
- Per-row display mapped to absolute frames
- Row = Speed × frames (e.g., Speed=4 → row spans 4 frames)
- Colour-coded by instrument (kick=blue, snare=red, melody=green...)
- Frame numbers in left column
- Imported from VT2 or .btp module

### Shared across all modes:
- **Event/marker layers**: independent overlay layers for different marker types
  - Sync events (effect changes)
  - Beat markers (kick hits, downbeats)
  - Section markers (intro, verse, chorus, drop)
  - Custom user layers
- **Frame-precise mapping**: every marker has an absolute frame number
- **Export as frame list**:
  ```asm
  ; sync_events.asm
  sync_table:
      dw 0       ; frame 0: intro start
      dw 200     ; frame 200: first beat
      dw 450     ; frame 450: melody in
      dw 1200    ; frame 1200: drop
      dw 65535   ; sentinel
  ```
- **Multiple export formats**:
  - `dw` frame list (Z80 assembly)
  - Per-frame value tables (baked keyframes)
  - JSON (for further processing)
  - Delta-encoded + ZX0 estimate

---

## 6. Reuse Strategy: Bitphase Components

### Reused from bitphase (Phases 1-3):
1. **VT2 parser** — ported from vt-converter.ts → `js/module-parser.js`
2. **BTP importer** — ported from file-import.ts → `js/module-parser.js` (pako for gunzip)
3. **ayumi-processor.js** — drop-in AudioWorklet, now in `js/worklet/`
4. **ayumi-engine.js** — WASM interface with delta updates, now in `js/engine/`
5. **Full engine stack** — 10 modules (effects, state, pattern processor, mixer) → `js/engine/`

### Built new for Clockwork:
1. **Frame unroller** — `js/frame-unroller.js`: PlayOrder × patterns × speed → flat frame map
2. **Pattern grid renderer** — `js/pattern-grid-renderer.js`: canvas-based n1k-o Excel view
3. **Marker/event layer system** — `js/marker-layer.js`: MarkerManager with JSON + ASM export
4. **Module player** — `js/module-player.js`: dual-player architecture (PSG + module)
5. **Golden Layout panels** — dockable UI with lil-gui parameter controls

### Not yet reused:
1. **PT3→VT2 converter** (pt3-to-vt2.ts — would enable .pt3 direct import)
2. **PSG exporter** (psg-export.ts — for BTP/VT2 → PSG offline rendering)

---

## 7. Row → Frame Mapping Detail

```
Given:
  PlayOrder = [0, 1, 2, 0, 3]  (L prefix = loop point)
  Pattern length = 64 rows each
  Speed = 4 (can change via S effect)
  FPS = 50 Hz

Then:
  Pattern 0: rows 0-63 → frames 0-255    (64 × 4 = 256 frames = 5.12 sec)
  Pattern 1: rows 0-63 → frames 256-511
  Pattern 2: rows 0-63 → frames 512-767
  Pattern 0: rows 0-63 → frames 768-1023  (repeat)
  Pattern 3: rows 0-63 → frames 1024-1279
  Total: 1280 frames = 25.6 seconds

  absolute_frame(order_idx, row) =
    sum(pattern_frames[0..order_idx-1]) + row × current_speed

  Note: Speed can change mid-pattern via effect S (0x53).
  Must track speed changes while unrolling.
```

---

## 8. Implementation Status (Phases 1-3)

### Phase 1: Module Import & Pattern Grid
- **VT2 import**: full Vortex Tracker 2 text format parser with samples, ornaments, patterns
- **BTP import**: Bitphase project format (gzip JSON) with pako decompression
- **Frame unroller**: converts PlayOrder × patterns × speed → flat frame array with speed-change tracking
- **Pattern grid renderer**: canvas-based visualization (n1k-o Excel-style), colour-coded by channel, scrollable

### Phase 2: Marker/Event Layer System
- **MarkerManager**: multi-layer marker system with named layers and typed markers
- **Export formats**: JSON (full fidelity) and ASM (`dw` frame tables with comments)
- **Layer operations**: add/remove/toggle layers, per-marker frame + label + colour

### Phase 3: Pull-Based Audio Engine (Bitphase Worklet)
- **Engine modules**: 10 pure-computation modules extracted from bitphase → `js/engine/`
- **AudioWorklet**: `ayumi-processor.js` runs full pattern engine inside worklet (pull-based timing)
- **ayumi WASM**: sample-accurate AY-3-8910 emulation via ayumi C library compiled to WebAssembly
- **Dual-player architecture**: `js/player.js` (PSG push-based) + `js/module-player.js` (module pull-based)
- **Features**: catch-up seeking, delta-only register updates, per-channel waveform extraction

### Architecture
```
js/
  engine/               — reusable AY music engine (10 modules)
    index.js            — barrel export
    ayumi-constants.js  — constants, pan settings, struct offsets
    pt3-volume-table.js — PT3 volume lookup table
    effect-algorithms.js — slide, portamento, arpeggio, vibrato, on-off
    tracker-state.js    — base tracker state
    ay-chip-register-state.js — AY register data structure
    ayumi-state.js      — AY-specific state (extends TrackerState)
    ay-audio-driver.js  — instrument/envelope/volume processing
    tracker-pattern-processor.js — pattern row parsing, effect tables
    virtual-channel-mixer.js — multi-channel → hardware channel merging
    ayumi-engine.js     — WASM bridge
  worklet/
    ayumi-processor.js  — AudioWorkletProcessor (imports from engine/)
    ayumi.wasm          — AY emulation binary
  module-parser.js      — VT2 + BTP format parsers
  frame-unroller.js     — PlayOrder → flat frame array
  module-player.js      — pull-based module playback
  pattern-grid-renderer.js — canvas pattern grid
  marker-layer.js       — marker/event layer system
```
