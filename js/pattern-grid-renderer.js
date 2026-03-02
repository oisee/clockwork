/**
 * Pattern grid renderer for Clockwork timeline.
 * Renders pattern data as coloured dots or note text in a canvas row area.
 *
 * Adapts to zoom level:
 *   Low zoom  -> coloured dots per channel
 *   High zoom -> note text ("C-4")
 *
 * Channel colors: A=green, B=blue, C=orange
 */

const CH_COLORS = ['#00ff88', '#4488ff', '#ffaa00'];
const CH_COLORS_DIM = ['#00aa55', '#2255aa', '#aa7700'];
const BOUNDARY_COLOR = '#7777aa';

/**
 * Render the pattern grid row content (notes/dots per channel).
 * Called from Timeline.render() for the pattern grid row.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} moduleData - UnrolledTimeline from frame-unroller
 * @param {number} scrollX - current horizontal scroll (in frames)
 * @param {number} zoom - pixels per frame
 * @param {number} y - top Y position of this row
 * @param {number} rowH - height of this row
 * @param {number} viewW - visible width in pixels
 */
export function renderPatternGrid(ctx, moduleData, scrollX, zoom, y, rowH, viewW) {
  if (!moduleData?.frames) return;

  const frames = moduleData.frames;
  const totalFrames = moduleData.totalFrames;
  const firstFrame = Math.max(0, Math.floor(scrollX));
  const lastFrame = Math.min(totalFrames - 1, Math.ceil(scrollX + viewW / zoom));

  const channelBandH = rowH / 3.5;
  const showText = zoom >= 8;

  // Label
  ctx.fillStyle = '#666688';
  ctx.globalAlpha = 0.5;
  ctx.font = '10px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('Pattern', 4, y + 10);
  ctx.globalAlpha = 1.0;

  // Divider line above
  ctx.strokeStyle = '#3a3a6a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y - 1);
  ctx.lineTo(viewW, y - 1);
  ctx.stroke();

  // Per-frame data
  for (let f = firstFrame; f <= lastFrame; f++) {
    const frame = frames[f];
    if (!frame || !frame.isRowStart) continue;

    const x = (f - scrollX) * zoom;
    const bw = Math.max(1, zoom * (f + 1 <= totalFrames ? 1 : 0) - 0.5);

    for (let ch = 0; ch < 3; ch++) {
      const row = frame.channels[ch];
      if (!row) continue;

      const bandY = y + ch * channelBandH + 14;
      const isNote = row.note && row.note !== '---' && row.note !== 'R--';
      const isRest = row.note === 'R--';

      if (isNote) {
        if (showText) {
          // High zoom: show note text with tinted background
          ctx.fillStyle = CH_COLORS[ch];
          ctx.globalAlpha = 0.15;
          ctx.fillRect(x, bandY, bw, channelBandH - 2);
          ctx.globalAlpha = 1.0;

          ctx.fillStyle = CH_COLORS[ch];
          ctx.font = `${Math.min(11, channelBandH - 2)}px monospace`;
          ctx.textAlign = 'left';
          ctx.fillText(row.note, x + 1, bandY + channelBandH - 4);
        } else {
          // Low zoom: coloured dot
          const vol = row.volume || 8;
          ctx.fillStyle = CH_COLORS[ch];
          ctx.globalAlpha = 0.3 + (vol / 15) * 0.7;
          ctx.fillRect(x, bandY, bw, channelBandH - 2);
          ctx.globalAlpha = 1.0;
        }
      } else if (isRest) {
        // Rest: thin dim line
        ctx.fillStyle = CH_COLORS_DIM[ch];
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x, bandY + channelBandH / 2 - 1, bw, 2);
        ctx.globalAlpha = 1.0;
      }
    }
  }
}

/**
 * Draw pattern boundary vertical lines across the full timeline height.
 * Called from Timeline.render() after all row content.
 */
export function renderPatternBoundaries(ctx, moduleData, scrollX, zoom, viewW, viewH) {
  if (!moduleData?.patternBoundaries) return;

  const firstFrame = Math.max(0, Math.floor(scrollX));
  const lastFrame = Math.ceil(scrollX + viewW / zoom);

  ctx.strokeStyle = BOUNDARY_COLOR;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;

  for (const bFrame of moduleData.patternBoundaries) {
    if (bFrame < firstFrame || bFrame > lastFrame) continue;
    const x = (bFrame - scrollX) * zoom;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, viewH);
    ctx.stroke();
  }

  ctx.globalAlpha = 1.0;
}
