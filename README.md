# Clockwork

ZX Spectrum demoscene sync editor. Frame-accurate AY-3-8910 music visualization and timeline.

**Status: Phase 0 (PSG Viewer MVP)**

## Quick Start

```sh
# no build step, no dependencies
python3 -m http.server 8088
# open http://localhost:8088
# drag-drop a .psg file
```

Or any other static file server (`npx serve`, etc).

## What It Does

- Loads PSG files (binary + zxtune123 text format)
- Plays AY music via ayumi AudioWorklet (sample-accurate emulation)
- Visualizes per-frame: volume bars, tone activity, noise, envelope, drum markers
- Scroll/zoom timeline, click-to-seek, keyboard shortcuts

## Keyboard

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `Home` | Stop (reset to frame 0) |
| `Left/Right` | Seek 1 frame |
| `Shift+Left/Right` | Seek 50 frames (1 sec) |
| `Mouse wheel` | Zoom timeline |
| `Click` | Seek to frame |

## Architecture

```
index.html          — UI shell
js/
  app.js            — main app, drag-drop, controls
  psg-parser.js     — binary + text PSG format parsers
  player.js         — playback engine (AudioWorklet @ 50Hz)
  ayumi-worklet.js  — AY-3-8910 emulation (from AYSir/ayumi)
  timeline.js       — canvas-based register visualization
css/
  style.css         — dark demoscene aesthetic
test/
  *.psg             — test files
```

No npm, no webpack, no React. ES modules + vanilla JS.

## Roadmap

See [DESIGN.md](DESIGN.md) for full specification.

- **Phase 0** (current): PSG viewer — load, visualize, play
- **Phase 1**: Sync track editor — keyframes, scenes, JSON export
- **Phase 2**: Music-aware triggers — drum→flash, auto-keyframes
- **Phase 3**: Z80 export — .a80 include files for demo engines
- **Phase 4**: Live preview — mzx video sync, Rocket protocol

## Credits

- **ayumi** — Peter Sovietov (AY emulation core)
- **AYSir** — DrSnuggles (AudioWorklet adaptation)
- **Vortex Tracker** — Sergey Bulba (tuning tables reference)

Part of the [Antique Toy](https://github.com/oisee/antique-toy) book project.

## License

MIT
