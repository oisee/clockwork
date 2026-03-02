# Clockwork

ZX Spectrum demoscene sync editor. Frame-accurate AY-3-8910 music visualization, module playback, and timeline.

**Status: Phase 1+ (Module Import + Pattern Grid + Markers + Pull-Based Engine)**

## Quick Start

```sh
# no build step, no dependencies
python3 -m http.server 8088
# open http://localhost:8088
# drag-drop a .psg, .vt2, or .btp file
```

Or any other static file server (`npx serve`, etc).

## What It Does

- Loads PSG files (binary + zxtune123 text format) — push-based playback
- Imports VT2 (Vortex Tracker 2) and BTP (Bitphase) modules — pull-based playback
- Plays AY music via ayumi AudioWorklet (sample-accurate WASM emulation)
- Pattern grid visualization (n1k-o Excel-style, colour-coded by channel)
- Marker/event layer system with JSON + ASM (`dw` frame table) export
- Per-frame visualization: volume bars, tone activity, noise, envelope, drum markers
- Golden Layout dockable panels with lil-gui parameter controls
- Scroll/zoom timeline, click-to-seek, keyboard shortcuts

## Keyboard

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Home` | Stop (reset to frame 0) |
| `Left/Right` | Seek 1 frame |
| `Shift+Left/Right` | Seek 50 frames (1 sec) |
| `M` | Add marker at current frame |
| `Insert` | Add scene |
| `Delete` | Delete scene |
| `Ctrl+O` | Open file |
| `Mouse wheel` | Scroll vertically |
| `Shift+wheel` | Scroll horizontally |
| `Ctrl+Shift+wheel` | Zoom timeline |
| `Click` | Seek to frame |

## Architecture

```
index.html                  — UI shell (Golden Layout panels)
js/
  app.js                    — main app, drag-drop, controls, lil-gui
  psg-parser.js             — binary + text PSG format parsers
  player.js                 — PSG playback engine (push-based, AudioWorklet @ 50Hz)
  module-parser.js          — VT2 + BTP format parsers
  module-player.js          — module playback engine (pull-based, AudioWorklet)
  frame-unroller.js         — PlayOrder × patterns × speed → flat frame array
  pattern-grid-renderer.js  — canvas-based pattern grid (n1k-o Excel view)
  marker-layer.js           — marker/event layer system (JSON + ASM export)
  timeline.js               — canvas-based register visualization
  engine/                   — reusable AY music engine modules
    index.js                — barrel export for all engine modules
    ayumi-constants.js      — constants, pan settings, struct offsets
    pt3-volume-table.js     — PT3 volume lookup table
    effect-algorithms.js    — slide, portamento, arpeggio, vibrato, on-off
    tracker-state.js        — base tracker state (position, speed, patterns)
    ay-chip-register-state.js — AY register data structure
    ayumi-state.js          — AY-specific state (extends TrackerState)
    ay-audio-driver.js      — instrument/envelope/volume processing
    tracker-pattern-processor.js — pattern row parsing, effect tables
    virtual-channel-mixer.js — multi-channel → hardware channel merging
    ayumi-engine.js         — WASM bridge (process, removeDC)
  worklet/
    ayumi-processor.js      — AudioWorkletProcessor (imports from engine/)
    ayumi.wasm              — AY-3-8910 emulation binary
css/
  style.css                 — dark demoscene aesthetic
test/
  *.psg                     — test files
```

No npm, no webpack, no React. ES modules + vanilla JS.

### Why `engine/` is separate from `worklet/`

The 10 modules in `js/engine/` are pure computation — pattern processing, effects,
state management, register mixing. They have zero Web Audio dependencies. Splitting
them out of the worklet directory means the same engine can power:

- **AudioWorklet playback** — `ayumi-processor.js` imports from `../engine/` (current)
- **Offline PSG rendering** — BTP/VT2 → PSG export without audio context (future)
- **Tests & visualization** — import from `engine/index.js` on the main thread

Only `ayumi-processor.js` (which extends `AudioWorkletProcessor`) stays in `worklet/`
because it must run in the worklet scope. The WASM binary stays alongside it for
serving convenience.

## Roadmap

See [DESIGN.md](DESIGN.md) for full specification.

- **Phase 0** ~~(current)~~: PSG viewer — load, visualize, play
- **Phase 1** (done): Module import (VT2 + BTP), pattern grid, frame unroller
- **Phase 2** (done): Marker/event layer system, JSON + ASM export
- **Phase 3** (done): Pull-based audio engine (bitphase worklet), dual-player architecture
- **Phase 4**: Sync track editor — keyframes, scenes, curve interpolation
- **Phase 5**: Music-aware triggers — drum detection, auto-keyframes
- **Phase 6**: Z80 full export — .a80 include files for demo engines
- **Phase 7**: Live preview — mzx video sync, Rocket protocol

## Credits

- **ayumi** — Peter Sovietov (AY emulation core)
- **AYSir** — DrSnuggles (AudioWorklet adaptation)
- **bitphase** — AY music engine (pattern processor, effects, WASM bridge)
- **Vortex Tracker** — Sergey Bulba (tuning tables reference)

Part of the [Antique Toy](https://github.com/oisee/antique-toy) book project.

## License

MIT
