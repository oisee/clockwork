/**
 * Canvas-based timeline for PSG register visualization.
 *
 * Shows per-frame:
 *   - Volume bars (channels A, B, C) — main visual
 *   - Tone activity indicators
 *   - Noise activity
 *   - Envelope triggers
 *   - Drum hit markers
 *   - Playback cursor
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
};

export class Timeline {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.psg = null;
    this.events = null;
    this.currentFrame = 0;
    this.scrollX = 0;       // in frames
    this.zoom = 4;          // pixels per frame
    this.minZoom = 1;
    this.maxZoom = 20;
    this.dragging = false;
    this.onSeek = null;     // callback(frame) when user clicks

    this.resize();
    this._bindEvents();
    this.render();
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
    this.render();
  }

  setFrame(frame) {
    this.currentFrame = frame;

    // Auto-scroll to keep cursor visible
    const cursorX = (frame - this.scrollX) * this.zoom;
    const margin = this.width * 0.15;
    if (cursorX > this.width - margin) {
      this.scrollX = frame - Math.floor((this.width - margin) / this.zoom);
    } else if (cursorX < margin) {
      this.scrollX = frame - Math.floor(margin / this.zoom);
    }
    this.scrollX = Math.max(0, this.scrollX);

    this.render();
  }

  _bindEvents() {
    // Click to seek
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this._seekFromMouse(e);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (this.dragging) this._seekFromMouse(e);
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });

    // Scroll to zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const frameAtMouse = this.scrollX + mouseX / this.zoom;

      if (e.deltaY < 0) {
        this.zoom = Math.min(this.maxZoom, this.zoom * 1.2);
      } else {
        this.zoom = Math.max(this.minZoom, this.zoom / 1.2);
      }

      // Keep frame under mouse stable
      this.scrollX = frameAtMouse - mouseX / this.zoom;
      this.scrollX = Math.max(0, this.scrollX);
      this.render();
    }, { passive: false });

    // Resize
    window.addEventListener('resize', () => {
      this.resize();
      this.render();
    });
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

    const frames = this.psg.frames;
    const totalFrames = this.psg.totalFrames;
    const zoom = this.zoom;
    const scroll = this.scrollX;

    // Visible frame range
    const firstFrame = Math.max(0, Math.floor(scroll));
    const lastFrame = Math.min(totalFrames - 1, Math.ceil(scroll + w / zoom));

    // Layout: divide height into rows
    const rowH = h / 8;
    const rows = {
      header: 0,
      volA: rowH * 1,
      volB: rowH * 2,
      volC: rowH * 3,
      toneA: rowH * 4,
      toneB: rowH * 4.75,
      toneC: rowH * 5.5,
      noise: rowH * 6.25,
      envelope: rowH * 7,
    };

    // Grid lines (every 50 frames = 1 second, every 10 frames)
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let f = Math.ceil(firstFrame / 10) * 10; f <= lastFrame; f += 10) {
      const x = (f - scroll) * zoom;
      ctx.strokeStyle = (f % 50 === 0) ? COLORS.gridMajor : COLORS.grid;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();

      // Time labels at second marks
      if (f % 50 === 0) {
        ctx.fillStyle = COLORS.textDim;
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${(f / 50).toFixed(0)}s`, x, 10);
      }
    }

    // Row labels
    ctx.fillStyle = COLORS.textDim;
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

    // Draw register data
    for (let f = firstFrame; f <= lastFrame; f++) {
      const r = frames[f];
      const x = (f - scroll) * zoom;
      const bw = Math.max(1, zoom - 0.5); // bar width

      // Volumes (0-15, scaled to row height)
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

      // Tone activity (show as thin bars, brightness = inverse of period = pitch)
      const mixer = r[7];
      const toneH = rowH * 0.6;
      for (let ch = 0; ch < 3; ch++) {
        const toneEnabled = !((mixer >> ch) & 1);
        const vol = r[8 + ch] & 0x0F;
        if (toneEnabled && vol > 0) {
          const period = r[ch * 2] | ((r[ch * 2 + 1] & 0x0F) << 8);
          // Map period (1-4095) to brightness (high pitch = bright)
          const brightness = Math.max(0.2, 1 - Math.log(Math.max(1, period)) / Math.log(4096));
          const colors = [COLORS.toneA, COLORS.toneB, COLORS.toneC];
          const yBase = [rows.toneA, rows.toneB, rows.toneC][ch];
          ctx.fillStyle = colors[ch];
          ctx.globalAlpha = brightness * 0.8;
          ctx.fillRect(x, yBase, bw, toneH);
          ctx.globalAlpha = 1.0;
        }
      }

      // Noise
      const noiseEnabled = ((mixer >> 3) & 7) !== 7; // at least one channel has noise
      if (noiseEnabled) {
        const noisePeriod = r[6] & 0x1F;
        const noiseH = rowH * 0.6;
        const brightness = noisePeriod > 0 ? Math.max(0.3, 1 - noisePeriod / 31) : 0.8;
        ctx.fillStyle = COLORS.noise;
        ctx.globalAlpha = brightness * 0.6;
        ctx.fillRect(x, rows.noise, bw, noiseH);
        ctx.globalAlpha = 1.0;
      }

      // Envelope shape changes
      if (f > 0 && r[13] !== frames[f - 1][13] && r[13] !== 0xFF) {
        ctx.fillStyle = COLORS.envelope;
        ctx.globalAlpha = 0.7;
        const envH = rowH * 0.6;
        ctx.fillRect(x, rows.envelope, bw, envH);
        ctx.globalAlpha = 1.0;
      }
    }

    // Drum markers (triangles above timeline)
    if (this.events?.drums) {
      ctx.fillStyle = COLORS.drum;
      for (const f of this.events.drums) {
        if (f < firstFrame || f > lastFrame) continue;
        const x = (f - scroll) * zoom;
        ctx.beginPath();
        ctx.moveTo(x, rows.header + 14);
        ctx.lineTo(x - 3, rows.header + 20);
        ctx.lineTo(x + 3, rows.header + 20);
        ctx.fill();
      }
    }

    // Playback cursor
    const cursorX = (this.currentFrame - scroll) * zoom;
    if (cursorX >= 0 && cursorX <= w) {
      // Vertical line
      ctx.strokeStyle = COLORS.cursor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, h);
      ctx.stroke();

      // Frame number
      ctx.fillStyle = COLORS.cursor;
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${this.currentFrame}`, cursorX, h - 4);
    }

    // Info bar at top
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    const timeStr = (this.currentFrame / 50).toFixed(2);
    ctx.fillText(
      `Frame ${this.currentFrame}/${totalFrames} | ${timeStr}s / ${(totalFrames / 50).toFixed(1)}s | Zoom: ${zoom.toFixed(1)}x`,
      w - 8, 12
    );
  }
}
