/**
 * Frame unroller for Clockwork.
 * Takes a ClockworkProject and unrolls patterns into individual frames,
 * expanding each row into `speed` ticks (frames).
 *
 * unrollToFrames(project) -> UnrolledTimeline
 *
 * UnrolledTimeline = {
 *   frames[]: per-frame data (patternOrderIndex, patternId, rowIndex, tick, channels, globals),
 *   totalFrames: number,
 *   durationSeconds: number,
 *   patternBoundaries[]: absolute frame numbers where patterns start
 * }
 */

export function unrollToFrames(project) {
  const frames = [];
  const patternBoundaries = [];
  let absoluteFrame = 0;
  let speed = project.initialSpeed;

  // Build pattern lookup by id
  const patternMap = new Map();
  for (const p of project.patterns) {
    patternMap.set(p.id, p);
  }

  for (let orderIdx = 0; orderIdx < project.patternOrder.length; orderIdx++) {
    const patternId = project.patternOrder[orderIdx];
    const pattern = patternMap.get(patternId);
    if (!pattern) continue;

    patternBoundaries.push(absoluteFrame);
    const numRows = pattern.length;

    for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
      // Check for speed effects on any channel
      for (let ch = 0; ch < 3; ch++) {
        const row = pattern.channels[ch]?.rows[rowIdx];
        if (row?.effect?.type === 'speed' && row.effect.param > 0) {
          speed = row.effect.param;
        }
      }

      // Emit `speed` frames for this row
      for (let tick = 0; tick < speed; tick++) {
        frames.push({
          patternOrderIndex: orderIdx,
          patternId,
          rowIndex: rowIdx,
          tick,
          isRowStart: tick === 0,
          isPatternStart: rowIdx === 0 && tick === 0,
          absoluteFrame,
          channels: [0, 1, 2].map(ch => pattern.channels[ch]?.rows[rowIdx] || null),
          globals: {
            envelopeValue: pattern.globals?.envelopeValues?.[rowIdx] || 0,
            noiseValue: pattern.globals?.noiseValues?.[rowIdx] || 0
          }
        });
        absoluteFrame++;
      }
    }
  }

  const intFreq = project.interruptFrequency || 50;

  return {
    frames,
    totalFrames: frames.length,
    durationSeconds: frames.length / intFreq,
    patternBoundaries
  };
}
