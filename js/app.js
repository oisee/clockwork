/**
 * Clockwork — main application.
 * Golden Layout panels: Timeline, Preview, Properties.
 * Wires together PSG parser, player, timeline, scene manager, and preview.
 */
import { GoldenLayout } from 'golden-layout';
import { parsePSG, analyzePSG } from './psg-parser.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { SceneManager } from './scene-manager.js';
import { PrototypeRenderer, OverlayCompositor } from './prototype-layer.js';
import { imageDataToSCR, renderSCRToImageData } from './spectrum.js';

// --- Shared state ---
let player = null;
let timeline = null;
let psg = null;
let sceneManager = null;
let protoRenderer = null;
let compositor = null;

// Preview state
let previewCanvas = null;
let previewMode = 'spectrum';
let attrFilterOn = true;
let lastScrImageData = null;

// Scene controls refs
let sceneEffectSelect = null;
let sceneInfoEl = null;

// --- UI elements (outside GL) ---
const fileInput = document.getElementById('file-input');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const btnDemo = document.getElementById('btn-demo');
const fileNameEl = document.getElementById('file-name');
const infoBar = document.getElementById('info-bar');
const statusBar = document.getElementById('status-bar');

function setStatus(msg, type = '') {
  console.log(`[clockwork] ${msg}`);
  statusBar.textContent = msg;
  statusBar.className = type;
}

// ======================================================================
// Golden Layout setup
// ======================================================================

const layoutContainer = document.getElementById('layout-container');
const layout = new GoldenLayout(layoutContainer);

// --- Component: Timeline ---
layout.registerComponentFactoryFunction('timeline', (container) => {
  const div = document.createElement('div');
  div.className = 'clockwork-panel panel-timeline';

  const canvas = document.createElement('canvas');
  div.appendChild(canvas);
  container.element.appendChild(div);

  // Init timeline after DOM is attached
  requestAnimationFrame(() => {
    timeline = new Timeline(canvas);
    timeline.sceneManager = sceneManager;

    timeline.onSeek = (frame) => {
      player.seek(frame);
      timeline.setFrame(frame);
      updatePreview(frame);
    };

    // ResizeObserver handles canvas sizing within the GL panel
    const ro = new ResizeObserver(() => {
      timeline.resize();
      timeline.render();
    });
    ro.observe(div);

    // If data is already loaded, show it
    if (psg && timeline) {
      timeline.load(psg, psg._events);
    }
  });
});

// --- Component: Preview ---
layout.registerComponentFactoryFunction('preview', (container) => {
  const div = document.createElement('div');
  div.className = 'clockwork-panel panel-preview';

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'preview-toolbar';
  toolbar.innerHTML = `
    <select id="preview-mode">
      <option value="prototype">Full Color</option>
      <option value="spectrum" selected>Spectrum</option>
      <option value="overlay">Overlay</option>
      <option value="difference">Difference</option>
    </select>
    <label class="toggle-label">
      <input type="checkbox" id="attr-filter" checked> Attr
    </label>
    <span style="margin-left:auto; font-size:10px; color:var(--text-dim)" id="preview-info"></span>
  `;
  div.appendChild(toolbar);

  // Canvas wrapper (centers and scales the preview)
  const wrap = document.createElement('div');
  wrap.className = 'preview-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 192;
  wrap.appendChild(canvas);
  div.appendChild(wrap);

  container.element.appendChild(div);

  // Store refs
  previewCanvas = canvas;
  compositor = new OverlayCompositor(canvas);

  // Offscreen canvas for prototype rendering
  const offscreen = document.createElement('canvas');
  offscreen.width = 256;
  offscreen.height = 192;
  protoRenderer = new PrototypeRenderer(offscreen);

  // Scale canvas to fit panel while maintaining aspect ratio
  const resizePreview = () => {
    const wrapRect = wrap.getBoundingClientRect();
    const aspect = 256 / 192;
    let w = wrapRect.width - 8;
    let h = w / aspect;
    if (h > wrapRect.height - 8) {
      h = wrapRect.height - 8;
      w = h * aspect;
    }
    // Snap to integer multiples for pixel-perfect rendering
    const scale = Math.max(1, Math.floor(w / 256));
    canvas.style.width = (256 * scale) + 'px';
    canvas.style.height = (192 * scale) + 'px';
  };
  const ro = new ResizeObserver(resizePreview);
  ro.observe(wrap);

  // Event listeners
  toolbar.querySelector('#preview-mode').addEventListener('change', (e) => {
    previewMode = e.target.value;
    updatePreview(player?.currentFrame ?? 0);
  });
  toolbar.querySelector('#attr-filter').addEventListener('change', (e) => {
    attrFilterOn = e.target.checked;
    updatePreview(player?.currentFrame ?? 0);
  });
});

// --- Component: Properties ---
layout.registerComponentFactoryFunction('properties', (container) => {
  const div = document.createElement('div');
  div.className = 'clockwork-panel panel-properties';

  div.innerHTML = `
    <div class="section-title">Scene</div>
    <div class="prop-row">
      <label>Effect:</label>
      <select id="scene-effect">
        <option value="">— none —</option>
        <option value="plasma">Plasma</option>
        <option value="bars">Bars</option>
        <option value="lissajous">Lissajous</option>
        <option value="starfield">Starfield</option>
      </select>
      <button id="btn-add-scene">+ Add</button>
    </div>
    <div id="scene-info" style="font-size:10px; color:var(--text-dim); margin-top:4px;"></div>

    <div class="section-title" style="margin-top:12px">File</div>
    <div class="prop-row">
      <button id="btn-browse">Open .psg</button>
    </div>
    <div id="gui-container" style="margin-top:12px;"></div>
  `;

  container.element.appendChild(div);

  // Store refs
  sceneEffectSelect = div.querySelector('#scene-effect');
  sceneInfoEl = div.querySelector('#scene-info');

  // Add scene button
  div.querySelector('#btn-add-scene').addEventListener('click', () => {
    if (!psg) { setStatus('Load a PSG file first', 'error'); return; }
    const effect = sceneEffectSelect.value;
    if (!effect) { setStatus('Select an effect first', 'error'); return; }
    const start = player.currentFrame;
    const end = Math.min(start + 100, psg.totalFrames);
    sceneManager.add(effect, start, end);
    setStatus(`Added "${effect}" at frame ${start}–${end}`, 'ok');
  });

  // Browse button
  div.querySelector('#btn-browse').addEventListener('click', () => fileInput.click());

  // lil-gui will be mounted into #gui-container when a scene is selected
  initLilGui(div.querySelector('#gui-container'));
});

// --- Default layout ---
const defaultConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'component',
        componentType: 'timeline',
        title: 'Timeline',
        size: '70%',
      },
      {
        type: 'column',
        size: '30%',
        content: [
          {
            type: 'component',
            componentType: 'preview',
            title: 'Preview',
            size: '60%',
          },
          {
            type: 'component',
            componentType: 'properties',
            title: 'Properties',
            size: '40%',
          },
        ],
      },
    ],
  },
};

// ======================================================================
// lil-gui for scene parameters
// ======================================================================

let gui = null;

async function initLilGui(container) {
  try {
    const { default: GUI } = await import('lil-gui');
    gui = new GUI({ container, autoPlace: false, width: 250 });
    gui.title('Scene Parameters');
    // Will be populated when a scene is active
  } catch (e) {
    console.warn('[clockwork] lil-gui not available:', e.message);
  }
}

function updateGuiForScene(scene) {
  if (!gui) return;
  // Clear existing controllers
  gui.controllersRecursive().forEach(c => c.destroy());
  gui.foldersRecursive().forEach(f => f.destroy());

  if (!scene) {
    gui.title('No Scene Selected');
    return;
  }

  gui.title(scene.label);

  // Default params per effect
  const defaults = {
    plasma: { speed: 1, scale: 1, palette: 0 },
    bars: { count: 8, speed: 1 },
    lissajous: { freqX: 3, freqY: 2, phase: 0, trail: 0.3 },
    starfield: { speed: 2, density: 1 },
  };

  const effectDefaults = defaults[scene.effect] || {};
  const params = { ...effectDefaults, ...scene.params };
  scene.params = params; // ensure scene has all defaults

  for (const [key, val] of Object.entries(params)) {
    if (key === 'palette') {
      gui.add(params, key, { Rainbow: 0, Fire: 1, Ice: 2 })
        .onChange(() => { scene.params = params; });
    } else if (typeof val === 'number') {
      const isInt = Number.isInteger(val) && val > 2;
      const min = 0;
      const max = isInt ? Math.max(20, val * 3) : 10;
      const step = isInt ? 1 : 0.1;
      gui.add(params, key, min, max, step)
        .onChange(() => { scene.params = params; });
    }
  }
}

// ======================================================================
// Preview rendering
// ======================================================================

function updatePreview(frame) {
  if (!psg || !previewCanvas) return;

  const scene = sceneManager.getAt(frame);

  // Update scene info
  if (sceneInfoEl) {
    sceneInfoEl.textContent = scene
      ? `${scene.label} [${scene.start}–${scene.end}] f=${frame - scene.start}/${scene.duration}`
      : `Frame ${frame} — no scene`;
  }

  // Update lil-gui
  updateGuiForScene(scene);

  // Update effect selector
  if (sceneEffectSelect && scene) {
    sceneEffectSelect.value = scene.effect;
  }

  // No scene = black preview
  if (!scene || !protoRenderer) {
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 192);
    return;
  }

  const t = scene.duration > 0 ? (frame - scene.start) / scene.duration : 0;
  const params = { ...scene.params, frame: frame - scene.start, t };

  protoRenderer.render(scene.effect, params);
  const protoImageData = protoRenderer.getImageData();

  if (previewMode === 'prototype' && !attrFilterOn) {
    previewCanvas.getContext('2d').putImageData(protoImageData, 0, 0);
  } else {
    const { scr } = imageDataToSCR(protoImageData);
    lastScrImageData = renderSCRToImageData(scr);

    if (previewMode === 'spectrum' || (previewMode === 'prototype' && attrFilterOn)) {
      previewCanvas.getContext('2d').putImageData(lastScrImageData, 0, 0);
    } else {
      compositor.mode = previewMode;
      compositor.alpha = 0.5;
      compositor.compose(lastScrImageData, protoImageData);
    }
  }
}

// ======================================================================
// Init + file loading
// ======================================================================

async function init() {
  console.log('[clockwork] init');
  player = new Player();
  sceneManager = new SceneManager();
  sceneManager.onChange = () => {
    if (timeline) timeline.render();
  };

  // Wire player callbacks
  player.onFrame = (frame) => {
    if (timeline) timeline.setFrame(frame);
    updatePreview(frame);
  };
  player.onEnd = () => updatePlayButton(false);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'Home') {
      player.stop();
      if (timeline) timeline.setFrame(0);
      updatePlayButton(false);
      updatePreview(0);
    }
    if (e.code === 'ArrowRight') {
      const step = e.shiftKey ? 50 : 1;
      player.seek(player.currentFrame + step);
      updatePreview(player.currentFrame);
    }
    if (e.code === 'ArrowLeft') {
      const step = e.shiftKey ? 50 : 1;
      player.seek(player.currentFrame - step);
      updatePreview(player.currentFrame);
    }
  });

  // Load Golden Layout
  layout.loadLayout(defaultConfig);

  setStatus('Ready — drop a .psg file or click Open');
}

async function handleFile(file) {
  console.log('[clockwork] handleFile:', file.name, file.size, 'bytes');

  if (!file.name.toLowerCase().endsWith('.psg')) {
    setStatus(`Not a .psg file: ${file.name}`, 'error');
    return;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const buffer = await file.arrayBuffer();
    psg = parsePSG(buffer);
    const events = analyzePSG(psg);
    psg._events = events; // stash for late-init timeline

    if (!player.audioCtx) await player.init();
    player.load(psg);

    if (timeline) {
      timeline.load(psg, events);
    }

    fileNameEl.textContent = file.name;
    infoBar.textContent = `${psg.totalFrames}f | ${psg.durationSeconds.toFixed(1)}s | ${events.drums.length} drums`;
    setStatus(`Loaded: ${file.name}`, 'ok');
    updatePlayButton(false);
    updatePreview(0);
  } catch (err) {
    console.error('[clockwork] error:', err);
    setStatus(`Error: ${err.message}`, 'error');
  }
}

function togglePlay() {
  if (!psg) return;
  if (player.playing) {
    player.pause();
    updatePlayButton(false);
  } else {
    player.play();
    updatePlayButton(true);
  }
}

function updatePlayButton(isPlaying) {
  btnPlay.textContent = isPlaying ? 'Pause' : 'Play';
  btnPlay.dataset.state = isPlaying ? 'playing' : 'paused';
}

// ======================================================================
// Event listeners (toolbar + drag-drop)
// ======================================================================

btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', () => {
  player?.stop();
  if (timeline) timeline.setFrame(0);
  updatePlayButton(false);
  updatePreview(0);
});

btnDemo.addEventListener('click', async () => {
  setStatus('Loading demo...');
  try {
    const resp = await fetch('demo.psg');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    await handleFile(new File([buffer], 'demo.psg'));
    btnDemo.style.display = 'none';
  } catch (err) {
    setStatus(`Demo failed: ${err.message}`, 'error');
  }
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// Drag-drop on entire window
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) handleFile(file);
});

// ======================================================================
// Boot
// ======================================================================

init().catch(err => {
  console.error('[clockwork] init failed:', err);
  setStatus(`Init failed: ${err.message}`, 'error');
});
