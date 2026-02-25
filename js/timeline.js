/**
 * Canvas-based timeline for PSG register visualization.
 *
 * Shows per-frame:
 *   - Volume bars (channels A, B, C) — main visual
 *   - Tone activity indicators
 *   - Noise activity
 *   - Envelope triggers
 *   - Drum hit markers
 *   - Scene track (colored blocks for visual effects)
 *   - Playback cursor
 *   - Horizontal + vertical scrollbars
 *
 * Gestures:
 *   Scroll          = vertical scroll
 *   Shift+Scroll    = horizontal scroll
 *   Ctrl+Shift+Scroll = zoom/scale
 */

const COLORS = {
  bg: '#1a1a2e',
  grid: '#2a2a4a',
  gridMajor: '#3a3a6a',
  cursor: '#ff3366',
  cursorLine: 'rgba(255, 51, 102, 0.4)',
  volA: '#00ff88',     // green
  volB: '#4488ff',     // blue
  volC: '#ffaa00',     // orange
  noise: '#ff4444',    // red
  envelope: '#aa44ff', // purple
  drum: '#ff6666',     // red marker
  text: '#ccccdd',
  textDim: '#666688',
  toneA: '#00aa55',
  toneB: '#2255aa',
  toneC: '#aa7700',
  // Collapsed music summary
  musicSummary: '#557799',
  foldButton: '#444466',
  foldButtonHover: '#555588',
  // Scrollbar
  scrollTrack: '#111122',
  scrollThumb: '#3a3a5a',
  scrollThumbHover: '#5a5a7a',
  scrollThumbActive: '#7a7a9a',
};

const SCROLLBAR_SIZE = 11;   // thickness in px
const MIN_ROW_HEIGHT = 36;   // minimum row height in px

export class Timeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.psg = null;
    this.events = null;
    this.currentFrame = 0;
    this.scrollX = 0;         // in frames
    this.scrollY = 0;         // in pixels (into virtual content)
    this.zoom = 4;            // pixels per frame
    this.minZoom = 0.5;
    this.maxZoom = 30;
    this.dragging = false;
    this.onSeek = null;       // callback(frame) when user clicks
    this.sceneManager = null; // set by app.js
    this.musicCollapsed = false; // fold 8 music rows → 1 summary

    // Scrollbar interaction state
    this._scrollbarDrag = null;  // { axis: 'x'|'y', startMouse, startScroll }
    this._hoverScrollbar = null; // 'x', 'y', or null

    this._bindEvents();

    // Defer initial resize until layout is ready
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        this.resize();
        this.render();
      });
      this._resizeObserver.observe(this.canvas);
    } else {
      requestAnimationFrame(() => {
        this.resize();
        this.render();
      });
    }
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;
  }

  load(psg, events) {
    this.psg = psg;
    this.events = events;
    this.scrollX = 0;
    this.scrollY = 0;
    this.render();
  }

  setFrame(frame) {
    this.currentFrame = frame;

    // Auto-scroll to keep cursor visible (horizontal only)
    const viewW = this.width - SCROLLBAR_SIZE;
    const cursorX = (frame - this.scrollX) * this.zoom;
    const margin = viewW * 0.15;
    if (cursorX > viewW - margin) {
      this.scrollX = frame - Math.floor((viewW - margin) / this.zoom);
    } else if (cursorX < margin) {
      this.scrollX = frame - Math.floor(margin / this.zoom);
    }
    this.scrollX = Math.max(0, this.scrollX);

    this.render();
  }

  /** Toggle music rows collapsed/expanded. */
  toggleMusicFold() {
    this.musicCollapsed = !this.musicCollapsed;
    this.scrollY = 0;
    this.render();
  }

  /** Compute row layout dimensions. */
  _layout() {
    const viewW = this.width - SCROLLBAR_SIZE;
    const viewH = this.height - SCROLLBAR_SIZE;
    // Collapsed: 1 music summary + 1 header + 1 scene = 3 virtual rows
    // Expanded:  1 header + 8 music rows + 1 scene = 10 (we use 9 with fractional)
    const numRows = this.musicCollapsed ? 3 : 9;
    const rowH = Math.max(MIN_ROW_HEIGHT, viewH / numRows);
    const contentH = rowH * numRows;
    return { viewW, viewH, rowH, contentH, numRows };
  }

  _clampScroll(layout) {
    const { viewW, viewH, contentH } = layout;
    const totalFrames = this.psg ? this.psg.totalFrames : 0;
    // Horizontal: frame-based
    const maxScrollX = Math.max(0, totalFrames - viewW / this.zoom);
    this.scrollX = Math.max(0, Math.min(this.scrollX, maxScrollX));
    // Vertical: pixel-based
    const maxScrollY = Math.max(0, contentH - viewH);
    this.scrollY = Math.max(0, Math.min(this.scrollY, maxScrollY));
  }

  _bindEvents() {
    // Click to seek (or scrollbar drag)
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Check scrollbar hit
      const sb = this._hitTestScrollbar(mx, my);
      if (sb) {
        this._scrollbarDrag = {
          axis: sb,
          startMouse: sb === 'x' ? mx : my,
          startScroll: sb === 'x' ? this.scrollX : this.scrollY,
        };
        return;
      }

      this.dragging = true;
      this._seekFromMouse(e);
    });

    // Double-click to toggle music fold
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const layout = this._layout();
      // Check if click is in the music area (not scene track, not scrollbar)
      const musicBottom = this.musicCollapsed
        ? layout.rowH * 2 - this.scrollY   // header + summary
        : layout.rowH * 8 - this.scrollY;  // header + 7 music rows
      if (my < musicBottom && my < layout.viewH) {
        this.toggleMusicFold();
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Scrollbar drag
      if (this._scrollbarDrag) {
        const layout = this._layout();
        const { axis, startMouse, startScroll } = this._scrollbarDrag;
        if (axis === 'x') {
          const trackW = layout.viewW;
          const totalFrames = this.psg ? this.psg.totalFrames : 1;
          const contentW = totalFrames * this.zoom;
          const ratio = contentW / trackW;
          const delta = (mx - startMouse) * ratio / this.zoom;
          this.scrollX = startScroll + delta;
        } else {
          const trackH = layout.viewH;
          const ratio = layout.contentH / trackH;
          const delta = (my - startMouse) * ratio;
          this.scrollY = startScroll + delta;
        }
        this._clampScroll(layout);
        this.render();
        return;
      }

      // Hover detection for scrollbar highlight
      const hover = this._hitTestScrollbar(mx, my);
      if (hover !== this._hoverScrollbar) {
        this._hoverScrollbar = hover;
        this.render();
      }

      if (this.dragging) this._seekFromMouse(e);
    });

    window.addEventListener('mouseup', () => {
      this.dragging = false;
      this._scrollbarDrag = null;
    });

    // Wheel gestures:
    //   plain        = vertical scroll
    //   Shift        = horizontal scroll
    //   Ctrl+Shift   = zoom (keep frame under mouse stable)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const layout = this._layout();

      if (e.ctrlKey && e.shiftKey) {
        // Zoom (keep frame under mouse stable)
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const frameAtMouse = this.scrollX + mouseX / this.zoom;

        if (e.deltaY < 0) {
          this.zoom = Math.min(this.maxZoom, this.zoom * 1.15);
        } else {
          this.zoom = Math.max(this.minZoom, this.zoom / 1.15);
        }

        this.scrollX = frameAtMouse - mouseX / this.zoom;
      } else if (e.shiftKey) {
        // Horizontal scroll
        const delta = (e.deltaY !== 0 ? e.deltaY : e.deltaX);
        this.scrollX += delta / this.zoom * 2;
      } else {
        // Vertical scroll
        this.scrollY += e.deltaY;
      }

      this._clampScroll(layout);
      this.render();
    }, { passive: false });

    // Resize
    window.addEventListener('resize', () => {
      this.resize();
      this.render();
    });
  }

  /** Hit-test scrollbar regions. Returns 'x', 'y', or null. */
  _hitTestScrollbar(mx, my) {
    const w = this.width;
    const h = this.height;
    // Horizontal scrollbar region: bottom strip
    if (my >= h - SCROLLBAR_SIZE && mx < w - SCROLLBAR_SIZE) return 'x';
    // Vertical scrollbar region: right strip
    if (mx >= w - SCROLLBAR_SIZE && my < h - SCROLLBAR_SIZE) return 'y';
    return null;
  }

  _seekFromMouse(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const frame = Math.round(this.scrollX + x / this.zoom);
    if (this.onSeek && this.psg) {
      this.onSeek(Math.max(0, Math.min(frame, this.psg.totalFrames - 1)));
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Clear
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    if (!this.psg) {
      // Empty state
      ctx.fillStyle = COLORS.textDim;
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Drop a .psg file here', w / 2, h / 2);
      return;
    }

    const layout = this._layout();
    const { viewW, viewH, rowH, contentH } = layout;
    this._clampScroll(layout);

    const frames = this.psg.frames;
    const totalFrames = this.psg.totalFrames;
    const zoom = this.zoom;
    const scrollX = this.scrollX;
    const scrollY = this.scrollY;

    // Visible frame range
    const firstFrame = Math.max(0, Math.floor(scrollX));
    const lastFrame = Math.min(totalFrames - 1, Math.ceil(scrollX + viewW / zoom));

    // Row positions depend on collapsed state
    const rowDefs = {};
    if (this.musicCollapsed) {
      rowDefs.header = 0;
      rowDefs.musicSummary = rowH * 1;  // single summary row
      rowDefs.scene = rowH * 2;
    } else {
      rowDefs.header = 0;
      rowDefs.volA = rowH * 1;
      rowDefs.volB = rowH * 2;
      rowDefs.volC = rowH * 3;
      rowDefs.toneA = rowH * 4;
      rowDefs.toneB = rowH * 4.75;
      rowDefs.toneC = rowH * 5.5;
      rowDefs.noise = rowH * 6.25;
      rowDefs.envelope = rowH * 7;
      rowDefs.scene = rowH * 8;
    }

    // Apply scrollY: all row Y positions shift up
    const rows = {};
    for (const [key, val] of Object.entries(rowDefs)) {
      rows[key] = val - scrollY;
    }

    // Clip to view area (exclude scrollbar regions)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, viewW, viewH);
    ctx.clip();

    // Grid lines (every 50 frames = 1 second, every 10 frames)
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let f = Math.ceil(firstFrame / 10) * 10; f <= lastFrame; f += 10) {
      const x = (f - scrollX) * zoom;
      ctx.strokeStyle = (f % 50 === 0) ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, viewH);
      ctx.stroke();

      // Time labels at second marks
      if (f % 50 === 0) {
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${(f / 50).toFixed(0)}s`, x, rows.header + 10);
      }
    }

    // --- Music rendering (collapsed or expanded) ---
    if (this.musicCollapsed) {
      this._renderMusicCollapsed(ctx, frames, firstFrame, lastFrame, scrollX, zoom, rows, rowH, viewW);
    } else {
      this._renderMusicExpanded(ctx, frames, firstFrame, lastFrame, scrollX, zoom, rows, rowH);
    }

    // Drum markers (triangles in header)
    if (this.events?.drums) {
      ctx.fillStyle = COLORS.drum;
      for (const f of this.events.drums) {
        if (f < firstFrame || f > lastFrame) continue;
        const x = (f - scrollX) * zoom;
        ctx.beginPath();
        ctx.moveTo(x, rows.header + 14);
        ctx.lineTo(x - 3, rows.header + 20);
        ctx.lineTo(x + 3, rows.header + 20);
        ctx.fill();
      }
    }

    // Scene track
    if (this.sceneManager) {
      const sceneY = rows.scene;
      const sceneH = rowH * 0.85;
      const scenes = this.sceneManager.getInRange(firstFrame, lastFrame + 1);

      // Scene track label
      ctx.fillStyle = COLORS.textDim;
      ctx.globalAlpha = 0.5;
      ctx.font = '10px monospace';
      ctx.textAlign = 'left';
      ctx.fillText('Scene', 4, sceneY + 10);
      ctx.globalAlpha = 1.0;

      // Divider line above scene track
      ctx.strokeStyle = COLORS.gridMajor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, sceneY - 1);
      ctx.lineTo(viewW, sceneY - 1);
      ctx.stroke();

      for (const scene of scenes) {
        const x1 = Math.max(0, (scene.start - scrollX) * zoom);
        const x2 = Math.min(viewW, (scene.end - scrollX) * zoom);
        if (x2 <= x1) continue;

        // Filled block
        ctx.fillStyle = scene.color;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x1, sceneY + 2, x2 - x1, sceneH);
        ctx.globalAlpha = 1.0;

        // Border
        ctx.strokeStyle = scene.color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x1, sceneY + 2, x2 - x1, sceneH);

        // Label (only if block is wide enough)
        const blockW = x2 - x1;
        if (blockW > 40) {
          ctx.fillStyle = scene.color;
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(scene.label, x1 + 4, sceneY + 14);

          if (blockW > 100) {
            ctx.font = '9px monospace';
            ctx.globalAlpha = 0.6;
            ctx.fillText(`${scene.start}-${scene.end}`, x1 + 4, sceneY + sceneH - 2);
            ctx.globalAlpha = 1.0;
          }
        }
      }
    }

    // Playback cursor
    const cursorX = (this.currentFrame - scrollX) * zoom;
    if (cursorX >= 0 && cursorX <= viewW) {
      ctx.strokeStyle = COLORS.cursor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, viewH);
      ctx.stroke();

      // Frame number
      ctx.fillStyle = COLORS.cursor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.currentFrame}`, cursorX, viewH - 4);
    }

    // Info bar at top
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    const timeStr = (this.currentFrame / 50).toFixed(2);
    ctx.fillText(
      `Frame ${this.currentFrame}/${totalFrames} | ${timeStr}s / ${(totalFrames / 50).toFixed(1)}s | Zoom: ${zoom.toFixed(1)}x`,
      viewW - 8, rows.header + 12
    );

    // End clipping for main content
    ctx.restore();

    // --- Scrollbars ---
    this._drawScrollbars(ctx, w, h, viewW, viewH, totalFrames, contentH);
  }

  /** Render expanded music: 8 separate rows (Vol A/B/C, Tone A/B/C, Noise, Env). */
  _renderMusicExpanded(ctx, frames, firstFrame, lastFrame, scrollX, zoom, rows, rowH) {
    // Row labels
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    const labels = [
      [rows.volA, 'Vol A', COLORS.volA],
      [rows.volB, 'Vol B', COLORS.volB],
      [rows.volC, 'Vol C', COLORS.volC],
      [rows.toneA, 'Tone A', COLORS.toneA],
      [rows.toneB, 'Tone B', COLORS.toneB],
      [rows.toneC, 'Tone C', COLORS.toneC],
      [rows.noise, 'Noise', COLORS.noise],
      [rows.envelope, 'Env', COLORS.envelope],
    ];
    for (const [y, label, color] of labels) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.fillText(label, 4, y + 10);
      ctx.globalAlpha = 1.0;
    }

    // Fold indicator
    ctx.fillStyle = COLORS.foldButton;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('\u25BC Music', 4, rows.header + 22); // ▼

    // Register data per frame
    for (let f = firstFrame; f <= lastFrame; f++) {
      const r = frames[f];
      const x = (f - scrollX) * zoom;
      const bw = Math.max(1, zoom - 0.5);

      const volScale = rowH * 0.9 / 15;
      const volA = r[8] & 0x0F;
      const volB = r[9] & 0x0F;
      const volC = r[10] & 0x0F;

      if (volA > 0) {
        ctx.fillStyle = COLORS.volA;
        ctx.globalAlpha = 0.3 + volA / 15 * 0.7;
        ctx.fillRect(x, rows.volA + rowH - volA * volScale, bw, volA * volScale);
        ctx.globalAlpha = 1.0;
      }
      if (volB > 0) {
        ctx.fillStyle = COLORS.volB;
        ctx.globalAlpha = 0.3 + volB / 15 * 0.7;
        ctx.fillRect(x, rows.volB + rowH - volB * volScale, bw, volB * volScale);
        ctx.globalAlpha = 1.0;
      }
      if (volC > 0) {
        ctx.fillStyle = COLORS.volC;
        ctx.globalAlpha = 0.3 + volC / 15 * 0.7;
        ctx.fillRect(x, rows.volC + rowH - volC * volScale, bw, volC * volScale);
        ctx.globalAlpha = 1.0;
      }

      const mixer = r[7];
      const toneH = rowH * 0.6;
      for (let ch = 0; ch < 3; ch++) {
        const toneEnabled = !((mixer >> ch) & 1);
        const vol = r[8 + ch] & 0x0F;
        if (toneEnabled && vol > 0) {
          const period = r[ch * 2] | ((r[ch * 2 + 1] & 0x0F) << 8);
          const brightness = Math.max(0.2, 1 - Math.log(Math.max(1, period)) / Math.log(4096));
          const colors = [COLORS.toneA, COLORS.toneB, COLORS.toneC];
          const yBase = [rows.toneA, rows.toneB, rows.toneC][ch];
          ctx.fillStyle = colors[ch];
          ctx.globalAlpha = brightness * 0.8;
          ctx.fillRect(x, yBase, bw, toneH);
          ctx.globalAlpha = 1.0;
        }
      }

      const noiseEnabled = ((mixer >> 3) & 7) !== 7;
      if (noiseEnabled) {
        const noisePeriod = r[6] & 0x1F;
        const noiseH = rowH * 0.6;
        const brightness = noisePeriod > 0 ? Math.max(0.3, 1 - noisePeriod / 31) : 0.8;
        ctx.fillStyle = COLORS.noise;
        ctx.globalAlpha = brightness * 0.6;
        ctx.fillRect(x, rows.noise, bw, noiseH);
        ctx.globalAlpha = 1.0;
      }

      if (f > 0 && r[13] !== frames[f - 1][13] && r[13] !== 0xFF) {
        ctx.fillStyle = COLORS.envelope;
        ctx.globalAlpha = 0.7;
        const envH = rowH * 0.6;
        ctx.fillRect(x, rows.envelope, bw, envH);
        ctx.globalAlpha = 1.0;
      }
    }
  }

  /**
   * Render collapsed music: single summary bar.
   * Shows combined volume heatmap (3 stacked thin bands for A/B/C),
   * noise ticks, and envelope markers — all in one row.
   */
  _renderMusicCollapsed(ctx, frames, firstFrame, lastFrame, scrollX, zoom, rows, rowH, viewW) {
    const y = rows.musicSummary;
    const bandH = rowH / 4;  // divide row into 4 bands: A, B, C, noise+env

    // Label
    ctx.fillStyle = COLORS.foldButton;
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('\u25B6 Music', 4, y + 10); // ▶

    // Divider lines
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(viewW, y);
    ctx.moveTo(0, y + rowH);
    ctx.lineTo(viewW, y + rowH);
    ctx.stroke();

    // Per-frame data
    for (let f = firstFrame; f <= lastFrame; f++) {
      const r = frames[f];
      const x = (f - scrollX) * zoom;
      const bw = Math.max(1, zoom - 0.5);

      const volA = r[8] & 0x0F;
      const volB = r[9] & 0x0F;
      const volC = r[10] & 0x0F;

      // Channel A band (top)
      if (volA > 0) {
        ctx.fillStyle = COLORS.volA;
        ctx.globalAlpha = 0.4 + volA / 15 * 0.6;
        ctx.fillRect(x, y + 2, bw, bandH - 1);
        ctx.globalAlpha = 1.0;
      }
      // Channel B band
      if (volB > 0) {
        ctx.fillStyle = COLORS.volB;
        ctx.globalAlpha = 0.4 + volB / 15 * 0.6;
        ctx.fillRect(x, y + bandH + 1, bw, bandH - 1);
        ctx.globalAlpha = 1.0;
      }
      // Channel C band
      if (volC > 0) {
        ctx.fillStyle = COLORS.volC;
        ctx.globalAlpha = 0.4 + volC / 15 * 0.6;
        ctx.fillRect(x, y + bandH * 2, bw, bandH - 1);
        ctx.globalAlpha = 1.0;
      }

      // Noise + envelope indicator (bottom band)
      const mixer = r[7];
      const noiseEnabled = ((mixer >> 3) & 7) !== 7;
      if (noiseEnabled) {
        ctx.fillStyle = COLORS.noise;
        ctx.globalAlpha = 0.5;
        ctx.fillRect(x, y + bandH * 3, bw, bandH - 2);
        ctx.globalAlpha = 1.0;
      }
      if (f > 0 && r[13] !== frames[f - 1][13] && r[13] !== 0xFF) {
        ctx.fillStyle = COLORS.envelope;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(x, y + bandH * 3, bw, bandH - 2);
        ctx.globalAlpha = 1.0;
      }
    }
  }

  _drawScrollbars(ctx, w, h, viewW, viewH, totalFrames, contentH) {
    const SB = SCROLLBAR_SIZE;

    // Corner (bottom-right dead zone)
    ctx.fillStyle = COLORS.scrollTrack;
    ctx.fillRect(viewW, viewH, SB, SB);

    // --- Horizontal scrollbar ---
    const contentW = totalFrames * this.zoom;
    const hVisible = contentW > 0 ? Math.min(1, viewW / contentW) : 1;
    const hOffset = contentW > 0 ? (this.scrollX * this.zoom) / contentW : 0;

    // Track
    ctx.fillStyle = COLORS.scrollTrack;
    ctx.fillRect(0, viewH, viewW, SB);

    // Thumb
    if (hVisible < 1) {
      const thumbW = Math.max(20, viewW * hVisible);
      const thumbX = hOffset * (viewW - thumbW);
      const isActive = this._scrollbarDrag?.axis === 'x';
      const isHover = this._hoverScrollbar === 'x';
      ctx.fillStyle = isActive ? COLORS.scrollThumbActive
                    : isHover  ? COLORS.scrollThumbHover
                               : COLORS.scrollThumb;
      ctx.beginPath();
      ctx.roundRect(thumbX + 1, viewH + 2, thumbW - 2, SB - 4, 3);
      ctx.fill();
    }

    // --- Vertical scrollbar ---
    const vVisible = contentH > 0 ? Math.min(1, viewH / contentH) : 1;
    const vOffset = contentH > viewH ? this.scrollY / (contentH - viewH) : 0;

    // Track
    ctx.fillStyle = COLORS.scrollTrack;
    ctx.fillRect(viewW, 0, SB, viewH);

    // Thumb
    if (vVisible < 1) {
      const thumbH = Math.max(20, viewH * vVisible);
      const thumbY = vOffset * (viewH - thumbH);
      const isActive = this._scrollbarDrag?.axis === 'y';
      const isHover = this._hoverScrollbar === 'y';
      ctx.fillStyle = isActive ? COLORS.scrollThumbActive
                    : isHover  ? COLORS.scrollThumbHover
                               : COLORS.scrollThumb;
      ctx.beginPath();
      ctx.roundRect(viewW + 2, thumbY + 1, SB - 4, thumbH - 2, 3);
      ctx.fill();
    }
  }
}
