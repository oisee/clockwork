/**
 * PSG format parser.
 *
 * PSG is a simple AY register dump: 14 registers per frame at 50 Hz (PAL).
 *
 * Format:
 *   Header (16 bytes): "PSG" 0x1A version freq padding...
 *   Data stream:
 *     0xFF        — start of new frame
 *     0x00..0x0D  — register number, next byte = value
 *     0xFE nn     — skip nn*4 empty frames
 *     0xFD        — end of music
 *
 * Returns: { frames: Array<Uint8Array(14)>, totalFrames: number }
 */
export function parsePSG(buffer) {
  const data = new Uint8Array(buffer);
  const frames = [];

  // Validate header
  if (data[0] !== 0x50 || data[1] !== 0x53 || data[2] !== 0x47 || data[3] !== 0x1A) {
    throw new Error('Not a PSG file (missing "PSG" + 0x1A header)');
  }

  // Current register state — carried forward between frames
  const regs = new Uint8Array(14);

  let pos = 16; // skip 16-byte header
  let inFrame = false;

  while (pos < data.length) {
    const byte = data[pos++];

    if (byte === 0xFD) {
      // End of music
      break;
    }

    if (byte === 0xFF) {
      // New frame marker — save previous frame if we were in one
      if (inFrame) {
        frames.push(new Uint8Array(regs));
      }
      inFrame = true;
      continue;
    }

    if (byte === 0xFE) {
      // Skip N*4 empty frames (re-emit current register state)
      if (inFrame) {
        frames.push(new Uint8Array(regs));
        inFrame = false;
      }
      const count = (pos < data.length) ? data[pos++] * 4 : 0;
      for (let i = 0; i < count; i++) {
        frames.push(new Uint8Array(regs));
      }
      continue;
    }

    if (byte <= 0x0D) {
      // AY register write
      if (pos < data.length) {
        regs[byte] = data[pos++];
      }
    }
    // bytes 0x0E..0xFB — ignored (MSX device registers)
  }

  // Push final frame if still pending
  if (inFrame) {
    frames.push(new Uint8Array(regs));
  }

  return {
    frames,
    totalFrames: frames.length,
    durationSeconds: frames.length / 50,
  };
}

/**
 * Analyze a parsed PSG for music events (drums, notes, silence).
 */
export function analyzePSG(psg) {
  const events = {
    drums: [],       // frames where noise+volume spike detected
    noteOnsets: [],  // frames where tone period changes with volume > 0
    silence: [],     // frames where all volumes = 0
  };

  let prevRegs = new Uint8Array(14);

  for (let f = 0; f < psg.frames.length; f++) {
    const r = psg.frames[f];

    // Volumes
    const volA = r[8] & 0x0F;
    const volB = r[9] & 0x0F;
    const volC = r[10] & 0x0F;

    // Mixer: bits 0-2 = tone off (A,B,C), bits 3-5 = noise off (A,B,C)
    const mixer = r[7];
    const noiseA = !((mixer >> 3) & 1);
    const noiseB = !((mixer >> 4) & 1);
    const noiseC = !((mixer >> 5) & 1);

    // Silence detection
    if (volA === 0 && volB === 0 && volC === 0) {
      events.silence.push(f);
    }

    // Drum detection: noise enabled + volume spike
    const prevVolA = prevRegs[8] & 0x0F;
    const prevVolB = prevRegs[9] & 0x0F;
    const prevVolC = prevRegs[10] & 0x0F;

    const noiseActive = noiseA || noiseB || noiseC;
    const volSpike = (volA > prevVolA + 2) || (volB > prevVolB + 2) || (volC > prevVolC + 2);
    const noisePeriodChanged = r[6] !== prevRegs[6];

    if (noiseActive && (volSpike || noisePeriodChanged) && (volA + volB + volC) > 4) {
      events.drums.push(f);
    }

    // Note onset detection: tone period changed + volume > 0
    for (let ch = 0; ch < 3; ch++) {
      const toneLoIdx = ch * 2;
      const toneHiIdx = ch * 2 + 1;
      const volIdx = 8 + ch;
      const vol = r[volIdx] & 0x0F;
      const tonePeriod = r[toneLoIdx] | ((r[toneHiIdx] & 0x0F) << 8);
      const prevTone = prevRegs[toneLoIdx] | ((prevRegs[toneHiIdx] & 0x0F) << 8);
      const toneEnabled = !((mixer >> ch) & 1);

      if (toneEnabled && vol > 0 && tonePeriod !== prevTone) {
        events.noteOnsets.push({ frame: f, channel: ch, period: tonePeriod, volume: vol });
      }
    }

    prevRegs = new Uint8Array(r);
  }

  return events;
}
