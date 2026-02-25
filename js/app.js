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
const fileName = document.getElementById('file-name');
const infoBar = document.getElementById('info-bar');
const controls = document.getElementById('controls');

// --- Init ---
async function init() {
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
}

// --- File loading ---
function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.psg')) {
    showError('Please drop a .psg file');
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      psg = parsePSG(e.target.result);
      const events = analyzePSG(psg);

      // Init audio on first file load (requires user gesture)
      if (!player.audioCtx) {
        await player.init();
      }

      player.load(psg);
      timeline.load(psg, events);

      // Update UI
      fileName.textContent = file.name;
      infoBar.textContent = `${psg.totalFrames} frames | ${psg.durationSeconds.toFixed(1)}s | ${events.drums.length} drums detected`;
      controls.classList.remove('hidden');
      dropZone.classList.add('loaded');

      updatePlayButton(false);
    } catch (err) {
      showError(err.message);
    }
  };
  reader.readAsArrayBuffer(file);
}

function showError(msg) {
  infoBar.textContent = msg;
  infoBar.style.color = '#ff4444';
  setTimeout(() => { infoBar.style.color = ''; }, 3000);
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
dropZone.addEventListener('click', () => {
  if (!psg) fileInput.click();
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
});

// --- Button handlers ---
btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', () => {
  player.stop();
  timeline.setFrame(0);
  updatePlayButton(false);
});

// --- Boot ---
init();
