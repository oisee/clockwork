/**
 * Clockwork — main application.
 * Golden Layout panels: Timeline, Preview, Properties.
 * Wires together PSG parser, player, timeline, scene manager, and preview.
 */
import { GoldenLayout } from 'golden-layout';
import { parsePSG, analyzePSG } from './psg-parser.js';
import { parseModule } from './module-parser.js';
import { unrollToFrames } from './frame-unroller.js';
import { Player } from './player.js';
import { ModulePlayer } from './module-player.js';
import { Timeline } from './timeline.js';
import { SceneManager } from './scene-manager.js';
import { MarkerManager } from './marker-layer.js';
import { PrototypeRenderer, OverlayCompositor } from './prototype-layer.js';
import { imageDataToSCR, renderSCRToImageData } from './spectrum.js';

// --- Shared state ---
let audioCtx = null;         // shared AudioContext
let psgPlayer = null;        // PSG push-based player
let modulePlayer = null;     // module pull-based player
let activePlayer = null;     // points to psgPlayer or modulePlayer
let timeline = null;
let psg = null;
let moduleData = null;       // UnrolledTimeline from module files (.vt2/.btp)
let currentProject = null;   // ClockworkProject from module files
let sceneManager = null;
let markerManager = null;
let protoRenderer = null;
let compositor = null;

// Backward compat: 'player' getter delegates to activePlayer
const player = new Proxy({}, {
  get(_, prop) { return activePlayer?.[prop]; },
  set(_, prop, value) { if (activePlayer) activePlayer[prop] = value; return true; }
});

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
const fileNameEl = document.getElementById('file-name');
const infoBar = document.getElementById('info-bar');
const statusBar = document.getElementById('status-bar');

function setStatus(msg, type = '') {
  console.log(`[clockwork] ${msg}`);
  statusBar.textContent = msg;
  statusBar.className = type;
}

// ======================================================================
// App menu
// ======================================================================

function initMenuBar() {
  const bar = document.getElementById('menu-bar');
  let openMenu = null;
  let hoverMode = false; // when true, hovering triggers switches dropdown

  function openDropdown(menu) {
    if (openMenu === menu) return;
    closeAll();
    menu.classList.add('open');
    openMenu = menu;
    hoverMode = true;
  }

  function closeAll() {
    if (openMenu) openMenu.classList.remove('open');
    openMenu = null;
    hoverMode = false;
  }

  // Click trigger → toggle
  bar.querySelectorAll('.menu-trigger').forEach(trigger => {
    trigger.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const menu = trigger.parentElement;
      if (openMenu === menu) { closeAll(); }
      else { openDropdown(menu); }
    });
  });

  // Hover between triggers while a menu is open
  bar.querySelectorAll('.menu').forEach(menu => {
    menu.addEventListener('mouseenter', () => {
      if (hoverMode && openMenu && openMenu !== menu) {
        openDropdown(menu);
      }
    });
  });

  // Click on dropdown item → dispatch action, close
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    closeAll();
    dispatchMenuAction(action);
  });

  // Click outside → close
  document.addEventListener('mousedown', (e) => {
    if (openMenu && !bar.contains(e.target)) closeAll();
  });

  // Escape → close
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && openMenu) { closeAll(); e.preventDefault(); }
  });

  // Ctrl+O shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') {
      e.preventDefault();
      dispatchMenuAction('open');
    }
  });
}

function dispatchMenuAction(action) {
  const actions = {
    // File
    'open': () => fileInput.click(),
    'demo': async () => {
      setStatus('Loading demo...');
      try {
        const resp = await fetch('demo.psg');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = await resp.arrayBuffer();
        await handleFile(new File([buffer], 'demo.psg'));
      } catch (err) {
        setStatus(`Demo failed: ${err.message}`, 'error');
      }
    },
    'export-scenes': () => {
      if (!sceneManager || sceneManager.all().length === 0) {
        setStatus('No scenes to export', 'error'); return;
      }
      const json = JSON.stringify(sceneManager.toJSON(), null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'scenes.json';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Exported scenes.json', 'ok');
    },
    'import-scenes': () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          sceneManager.fromJSON(JSON.parse(text));
          setStatus(`Imported ${sceneManager.all().length} scenes`, 'ok');
        } catch (err) {
          setStatus(`Import failed: ${err.message}`, 'error');
        }
      });
      input.click();
    },

    // View
    'reset-layout': () => {
      layout.clear();
      layout.loadLayout(defaultConfig);
      setStatus('Layout reset', 'ok');
    },
    'panel-timeline': () => addPanel('timeline', 'Timeline'),
    'panel-preview': () => addPanel('preview', 'Preview'),
    'panel-properties': () => addPanel('properties', 'Properties'),
    'zoom-in': () => { if (timeline) { timeline.zoomIn(); timeline.render(); } },
    'zoom-out': () => { if (timeline) { timeline.zoomOut(); timeline.render(); } },
    'zoom-fit': () => { if (timeline) { timeline.zoomToFit(); timeline.render(); } },

    // Transport
    'play': () => togglePlay(),
    'stop': () => {
      player?.stop();
      if (timeline) timeline.setFrame(0);
      updatePlayButton(false);
      updatePreview(0);
    },
    'goto-start': () => {
      player?.stop();
      if (timeline) timeline.setFrame(0);
      updatePlayButton(false);
      updatePreview(0);
    },
    'step-fwd': () => {
      if (!player) return;
      player.seek(player.currentFrame + 1);
      updatePreview(player.currentFrame);
    },
    'step-back': () => {
      if (!player) return;
      player.seek(player.currentFrame - 1);
      updatePreview(player.currentFrame);
    },
    'jump-fwd': () => {
      if (!player) return;
      player.seek(player.currentFrame + 50);
      updatePreview(player.currentFrame);
    },
    'jump-back': () => {
      if (!player) return;
      player.seek(player.currentFrame - 50);
      updatePreview(player.currentFrame);
    },

    // Scene
    'add-scene': () => {
      if (!psg) { setStatus('Load a PSG file first', 'error'); return; }
      const effect = sceneEffectSelect?.value || 'plasma';
      const start = player.currentFrame;
      const end = Math.min(start + 100, psg.totalFrames);
      sceneManager.add(effect, start, end);
      setStatus(`Added "${effect}" at frame ${start}–${end}`, 'ok');
    },
    'delete-scene': () => {
      if (!player || !sceneManager) return;
      const scene = sceneManager.getAt(player.currentFrame);
      if (scene) {
        sceneManager.remove(scene.id);
        setStatus(`Deleted scene "${scene.label}"`, 'ok');
      } else {
        setStatus('No scene at current frame', 'error');
      }
    },
    'clear-scenes': () => {
      if (!sceneManager) return;
      sceneManager.clear();
      setStatus('All scenes cleared', 'ok');
    },

    // Markers
    'add-marker-layer': () => {
      const name = prompt('Layer name:', `Layer ${markerManager.allLayers().length + 1}`);
      if (!name) return;
      const layer = markerManager.addLayer(name);
      setStatus(`Added marker layer "${name}"`, 'ok');
    },
    'add-marker': () => {
      if (!psg || !player) { setStatus('Load a file first', 'error'); return; }
      const layers = markerManager.allLayers();
      if (layers.length === 0) {
        markerManager.addLayer('Sync');
      }
      const layer = markerManager.allLayers()[0];
      const frame = player.currentFrame;
      const label = prompt('Marker label:', `m${layer.markers.length}`);
      if (label === null) return;
      markerManager.addMarker(layer.id, frame, label);
      setStatus(`Marker "${label}" at frame ${frame}`, 'ok');
    },
    'export-markers-json': () => {
      if (markerManager.allLayers().length === 0) {
        setStatus('No marker layers to export', 'error'); return;
      }
      const json = markerManager.exportJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'markers.json';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Exported markers.json', 'ok');
    },
    'export-markers-asm': () => {
      const layers = markerManager.allLayers();
      if (layers.length === 0) {
        setStatus('No marker layers to export', 'error'); return;
      }
      const asm = layers.map(l => markerManager.exportAsm(l.id)).join('\n');
      const blob = new Blob([asm], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'markers.asm';
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('Exported markers.asm', 'ok');
    },
    'import-markers': () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          markerManager.fromJSON(JSON.parse(text));
          setStatus(`Imported ${markerManager.allLayers().length} marker layers`, 'ok');
        } catch (err) {
          setStatus(`Import failed: ${err.message}`, 'error');
        }
      });
      input.click();
    },

    // Help
    'shortcuts': () => showShortcutsDialog(),
    'about': () => showAboutDialog(),
  };

  const fn = actions[action];
  if (fn) fn();
  else console.warn(`[clockwork] unknown menu action: ${action}`);
}

/** Try to add a panel to the layout (if not already present). */
function addPanel(componentType, title) {
  try {
    layout.addComponent(componentType, undefined, title);
  } catch (e) {
    setStatus(`Could not add ${title} panel`, 'error');
  }
}

function showShortcutsDialog() {
  const shortcuts = [
    ['Space', 'Play / Pause'],
    ['Home', 'Go to start'],
    ['\u2190 / \u2192', 'Step back / forward'],
    ['Shift + \u2190 / \u2192', 'Jump 50 frames'],
    ['Scroll', 'Vertical scroll'],
    ['Shift + Scroll', 'Horizontal scroll'],
    ['Ctrl+Shift + Scroll', 'Zoom'],
    ['DblClick row', 'Fold / unfold music'],
    ['Ctrl+O', 'Open file'],
    ['Insert', 'Add scene'],
    ['Delete', 'Delete scene at cursor'],
    ['M', 'Add marker at cursor'],
  ];
  const html = shortcuts.map(([k, d]) =>
    `<div class="shortcut-row"><kbd>${k}</kbd><span>${d}</span></div>`
  ).join('');
  showDialog('Keyboard Shortcuts', html);
}

function showAboutDialog() {
  showDialog('About Clockwork', `
    <p><strong>Clockwork</strong> — ZX Spectrum Sync Editor v0.2</p>
    <p style="margin-top:8px; color:var(--text-dim)">
      Demoscene synchronization tool for AY-3-8910 music.<br>
      Golden Layout + Canvas + ES Modules. No build step.
    </p>
  `);
}

function showDialog(title, contentHTML) {
  // Remove existing dialog
  document.querySelector('.cw-dialog-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'cw-dialog-overlay';
  overlay.innerHTML = `
    <div class="cw-dialog">
      <div class="cw-dialog-title">${title}<button class="cw-dialog-close">\u00d7</button></div>
      <div class="cw-dialog-body">${contentHTML}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('.cw-dialog-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.code === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
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
    timeline.markerManager = markerManager;

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
      timeline.load(psg, psg._events, moduleData);
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
    <select id="preview-scale">
      <option value="1">x1</option>
      <option value="2" selected>x2</option>
      <option value="3">x3</option>
      <option value="fit">Fit</option>
    </select>
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

  // Scale preview canvas
  let previewScaleMode = '2'; // default x2

  const applyPreviewScale = () => {
    if (previewScaleMode === 'fit') {
      const wrapRect = wrap.getBoundingClientRect();
      const aspect = 256 / 192;
      let w = wrapRect.width - 8;
      let h = w / aspect;
      if (h > wrapRect.height - 8) {
        h = wrapRect.height - 8;
        w = h * aspect;
      }
      const scale = Math.max(1, Math.floor(w / 256));
      canvas.style.width = (256 * scale) + 'px';
      canvas.style.height = (192 * scale) + 'px';
    } else {
      const scale = parseInt(previewScaleMode) || 2;
      canvas.style.width = (256 * scale) + 'px';
      canvas.style.height = (192 * scale) + 'px';
    }
  };
  applyPreviewScale();

  const ro = new ResizeObserver(() => {
    if (previewScaleMode === 'fit') applyPreviewScale();
  });
  ro.observe(wrap);

  // Scale selector
  toolbar.querySelector('#preview-scale').addEventListener('change', (e) => {
    previewScaleMode = e.target.value;
    applyPreviewScale();
  });

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
  psgPlayer = new Player();
  modulePlayer = new ModulePlayer();
  activePlayer = psgPlayer; // default to PSG player

  sceneManager = new SceneManager();
  sceneManager.onChange = () => {
    if (timeline) timeline.render();
  };
  markerManager = new MarkerManager();
  markerManager.onChange = () => {
    if (timeline) timeline.render();
  };

  // Wire player callbacks (both players)
  const onFrame = (frame) => {
    if (timeline) timeline.setFrame(frame);
    updatePreview(frame);
  };
  const onEnd = () => updatePlayButton(false);
  psgPlayer.onFrame = onFrame;
  psgPlayer.onEnd = onEnd;
  modulePlayer.onFrame = onFrame;
  modulePlayer.onEnd = onEnd;

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
    if (e.code === 'KeyM') {
      dispatchMenuAction('add-marker');
    }
  });

  // Load Golden Layout
  layout.loadLayout(defaultConfig);

  setStatus('Ready — drop a .psg / .vt2 / .btp file or click Open');
}

async function getSharedAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext({ sampleRate: 44100 });
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  return audioCtx;
}

async function handleFile(file) {
  console.log('[clockwork] handleFile:', file.name, file.size, 'bytes');

  const ext = file.name.toLowerCase().split('.').pop();
  const moduleExts = ['vt2', 'btp'];

  // Stop any current playback
  activePlayer?.stop();
  updatePlayButton(false);

  setStatus(`Loading ${file.name}...`);

  try {
    const ctx = await getSharedAudioContext();

    if (moduleExts.includes(ext)) {
      // --- Module path (VT2 / BTP) ---
      const project = await parseModule(file);
      currentProject = project;
      moduleData = unrollToFrames(project);

      // Create synthetic PSG for backward compatibility (timeline rendering)
      psg = {
        frames: Array.from({ length: moduleData.totalFrames }, () => new Uint8Array(14)),
        totalFrames: moduleData.totalFrames,
        durationSeconds: moduleData.durationSeconds,
        _events: { drums: [], noteOnsets: [], silence: [] }
      };

      // Init module player and switch to it
      if (!modulePlayer.audioCtx) await modulePlayer.init(ctx);
      modulePlayer.load(project, moduleData);
      activePlayer = modulePlayer;

      if (timeline) {
        timeline.load(psg, psg._events, moduleData);
      }

      fileNameEl.textContent = file.name;
      const info = [
        project.name || file.name,
        project.author ? `by ${project.author}` : '',
        `${moduleData.totalFrames}f`,
        `${moduleData.durationSeconds.toFixed(1)}s`,
        `${project.patternOrder.length} patterns`
      ].filter(Boolean).join(' | ');
      infoBar.textContent = info;
      setStatus(`Loaded: ${file.name}`, 'ok');
    } else {
      // --- PSG path (existing) ---
      if (ext !== 'psg') {
        setStatus(`Unsupported format: .${ext}`, 'error');
        return;
      }

      moduleData = null;
      currentProject = null;
      const buffer = await file.arrayBuffer();
      psg = parsePSG(buffer);
      const events = analyzePSG(psg);
      psg._events = events;

      // Init PSG player and switch to it
      if (!psgPlayer.audioCtx) await psgPlayer.init(ctx);
      psgPlayer.load(psg);
      activePlayer = psgPlayer;

      if (timeline) {
        timeline.load(psg, events);
      }

      fileNameEl.textContent = file.name;
      infoBar.textContent = `${psg.totalFrames}f | ${psg.durationSeconds.toFixed(1)}s | ${events.drums.length} drums`;
      setStatus(`Loaded: ${file.name}`, 'ok');
    }

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

initMenuBar();

btnPlay.addEventListener('click', togglePlay);
btnStop.addEventListener('click', () => {
  player?.stop();
  if (timeline) timeline.setFrame(0);
  updatePlayButton(false);
  updatePreview(0);
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
