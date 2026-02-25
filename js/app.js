/**
 * Clockwork — main application.
 * Wires together PSG parser, player, timeline, scene manager, and preview.
 */
import { parsePSG, analyzePSG } from './psg-parser.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { SceneManager } from './scene-manager.js';
import { PrototypeRenderer, OverlayCompositor } from './prototype-layer.js';
import { imageDataToSCR, renderSCRToImageData } from './spectrum.js';

let player = null;
let timeline = null;
let psg = null;
let sceneManager = null;
let protoRenderer = null;
let compositor = null;

// --- UI elements ---
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvas = document.getElementById('timeline');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const fileNameEl = document.getElementById('file-name');
const infoBar = document.getElementById('info-bar');
const controls = document.getElementById('controls');
const statusBar = document.getElementById('status-bar');

// Preview panel elements
const previewCanvas = document.getElementById('preview-canvas');
const previewMode = document.getElementById('preview-mode');
const attrFilter = document.getElementById('attr-filter');
const sceneEffect = document.getElementById('scene-effect');
const btnAddScene = document.getElementById('btn-add-scene');
const sceneInfo = document.getElementById('scene-info');

// Preview state
let lastPreviewFrame = -1;
let lastScrImageData = null;
let previewDirty = true;

function setStatus(msg, type = '') {
  console.log(`[clockwork] ${msg}`);
  statusBar.textContent = msg;
  statusBar.className = type; // '', 'error', 'ok'
}

// --- Init ---
async function init() {
  console.log('[clockwork] init');
  player = new Player();
  timeline = new Timeline(canvas);

  // Scene manager
  sceneManager = new SceneManager();
  timeline.sceneManager = sceneManager;
  sceneManager.onChange = () => {
    previewDirty = true;
    timeline.render();
  };

  // Preview renderer (offscreen 256x192 canvas for effect rendering)
  const offscreen = document.createElement('canvas');
  offscreen.width = 256;
  offscreen.height = 192;
  protoRenderer = new PrototypeRenderer(offscreen);

  // Compositor draws onto the visible preview canvas
  compositor = new OverlayCompositor(previewCanvas);

  // Wire callbacks
  player.onFrame = (frame) => {
    timeline.setFrame(frame);
    updatePreview(frame);
  };
  player.onEnd = () => {
    updatePlayButton(false);
  };
  timeline.onSeek = (frame) => {
    player.seek(frame);
    timeline.setFrame(frame);
    updatePreview(frame);
  };

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'Home') {
      player.stop();
      timeline.setFrame(0);
      updatePlayButton(false);
      updatePreview(0);
    }
    if (e.code === 'ArrowRight') {
      const step = e.shiftKey ? 50 : 1;
      const f = player.currentFrame + step;
      player.seek(f);
      updatePreview(f);
    }
    if (e.code === 'ArrowLeft') {
      const step = e.shiftKey ? 50 : 1;
      const f = player.currentFrame - step;
      player.seek(f);
      updatePreview(f);
    }
  });

  setStatus('Ready — drop a .psg file or click to browse');
}

// --- Preview rendering ---
function updatePreview(frame) {
  if (!psg) return;

  const scene = sceneManager.getAt(frame);

  // Update scene info display
  if (scene) {
    sceneInfo.textContent = `${scene.label} [${scene.start}–${scene.end}] f=${frame - scene.start}/${scene.duration}`;
    sceneEffect.value = scene.effect;
  } else {
    sceneInfo.textContent = `Frame ${frame} — no scene`;
  }

  // No scene = black preview
  if (!scene) {
    const ctx = previewCanvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 256, 192);
    lastPreviewFrame = frame;
    return;
  }

  // Compute t (normalized time within scene)
  const t = scene.duration > 0 ? (frame - scene.start) / scene.duration : 0;
  const params = {
    ...scene.params,
    frame: frame - scene.start,
    t: t,
  };

  // Render the effect (full color)
  protoRenderer.render(scene.effect, params);
  const protoImageData = protoRenderer.getImageData();

  const mode = previewMode.value;
  const useAttr = attrFilter.checked;

  if (mode === 'prototype' && !useAttr) {
    // Fast path: just show the prototype
    const ctx = previewCanvas.getContext('2d');
    ctx.putImageData(protoImageData, 0, 0);
  } else {
    // Need spectrum-quantized version
    const { scr, tax } = imageDataToSCR(protoImageData);
    lastScrImageData = renderSCRToImageData(scr);

    if (mode === 'spectrum' || (mode === 'prototype' && useAttr)) {
      const ctx = previewCanvas.getContext('2d');
      ctx.putImageData(lastScrImageData, 0, 0);
    } else {
      // Composite modes (overlay, difference)
      compositor.mode = mode;
      compositor.alpha = 0.5;
      compositor.compose(lastScrImageData, protoImageData);
    }
  }

  lastPreviewFrame = frame;
}

// --- File loading ---
async function handleFile(file) {
  console.log('[clockwork] handleFile:', file.name, file.size, 'bytes');

  if (!file.name.toLowerCase().endsWith('.psg')) {
    setStatus(`Not a .psg file: ${file.name}`, 'error');
    return;
  }

  setStatus(`Loading ${file.name}...`);

  try {
    const buffer = await file.arrayBuffer();
    console.log('[clockwork] file read, parsing PSG...');

    psg = parsePSG(buffer);
    console.log('[clockwork] parsed:', psg.totalFrames, 'frames');

    const events = analyzePSG(psg);
    console.log('[clockwork] analyzed:', events.drums.length, 'drums');

    // Init audio on first file load (requires user gesture)
    if (!player.audioCtx) {
      console.log('[clockwork] initializing audio...');
      await player.init();
      console.log('[clockwork] audio ready');
    }

    player.load(psg);
    timeline.load(psg, events);

    // Update UI
    fileNameEl.textContent = file.name;
    infoBar.textContent = `${psg.totalFrames} frames | ${psg.durationSeconds.toFixed(1)}s | ${events.drums.length} drums detected`;
    controls.classList.remove('hidden');
    dropZone.classList.add('loaded');
    setStatus(`Loaded: ${file.name} — ${psg.totalFrames} frames (${psg.durationSeconds.toFixed(1)}s)`, 'ok');

    updatePlayButton(false);
    updatePreview(0);
  } catch (err) {
    console.error('[clockwork] error:', err);
    setStatus(`Error: ${err.message}`, 'error');
  }
}

// --- Playback controls ---
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

// --- Scene management ---
btnAddScene.addEventListener('click', () => {
  if (!psg) {
    setStatus('Load a PSG file first', 'error');
    return;
  }
  const effect = sceneEffect.value;
  if (!effect) {
    setStatus('Select an effect first', 'error');
    return;
  }
  // Place scene at current frame, duration = 100 frames (2 seconds)
  const start = player.currentFrame;
  const end = Math.min(start + 100, psg.totalFrames);
  sceneManager.add(effect, start, end);
  setStatus(`Added "${effect}" scene at frame ${start}–${end}`, 'ok');
});

// Preview mode change → refresh
previewMode.addEventListener('change', () => {
  updatePreview(player.currentFrame);
});
attrFilter.addEventListener('change', () => {
  updatePreview(player.currentFrame);
});

// --- Drag & drop ---
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('dragover');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// Also handle click-to-browse
dropZone.addEventListener('click', (e) => {
  // Don't open file dialog if clicking on controls
  if (e.target.closest('#controls')) return;
  if (!psg) fileInput.click();
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// --- Button handlers ---
btnPlay.addEventListener('click', (e) => {
  e.stopPropagation(); // prevent drop-zone click
  togglePlay();
});
btnStop.addEventListener('click', (e) => {
  e.stopPropagation();
  player.stop();
  timeline.setFrame(0);
  updatePlayButton(false);
  updatePreview(0);
});

// --- Demo file ---
const btnDemo = document.getElementById('btn-demo');

async function loadDemo() {
  setStatus('Loading demo...');
  try {
    const resp = await fetch('demo.psg');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = await resp.arrayBuffer();
    const file = new File([buffer], 'demo.psg');
    await handleFile(file);
    btnDemo.classList.add('hidden');
  } catch (err) {
    console.error('[clockwork] demo load failed:', err);
    setStatus(`Demo load failed: ${err.message}`, 'error');
  }
}

btnDemo.addEventListener('click', loadDemo);

// --- Boot ---
init().catch(err => {
  console.error('[clockwork] init failed:', err);
  setStatus(`Init failed: ${err.message}`, 'error');
});
