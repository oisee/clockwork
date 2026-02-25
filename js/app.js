/**
 * Clockwork — main application.
 * Wires together PSG parser, player, and timeline.
 */
import { parsePSG, analyzePSG } from './psg-parser.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';

let player = null;
let timeline = null;
let psg = null;

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

  // Wire callbacks
  player.onFrame = (frame) => {
    timeline.setFrame(frame);
  };
  player.onEnd = () => {
    updatePlayButton(false);
  };
  timeline.onSeek = (frame) => {
    player.seek(frame);
    timeline.setFrame(frame);
  };

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    }
    if (e.code === 'Home') {
      player.stop();
      timeline.setFrame(0);
      updatePlayButton(false);
    }
    if (e.code === 'ArrowRight') {
      const step = e.shiftKey ? 50 : 1;
      player.seek(player.currentFrame + step);
    }
    if (e.code === 'ArrowLeft') {
      const step = e.shiftKey ? 50 : 1;
      player.seek(player.currentFrame - step);
    }
  });

  setStatus('Ready — drop a .psg file or click to browse');
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
