/**
 * PSG format parser.
 *
 * Supports two formats:
 *
 * 1. Binary PSG (header "PSG" + 0x1A):
 *    Header (16 bytes), then data stream:
 *      0xFF = frame marker, 0x00..0x0D = register write, 0xFE = skip, 0xFD = end
 *
 * 2. Text PSG (zxtune123 dump, starts with "# PSG Dump"):
 *    Comment lines starting with #, then one line per frame:
 *    14 hex bytes separated by spaces = R0..R13
 *
 * Returns: { frames: Array<Uint8Array(14)>, totalFrames: number }
 */
export function parsePSG(buffer) {
  const data = new Uint8Array(buffer);

  // Detect format
  if (data[0] === 0x23) { // '#' = text format
    return parseTextPSG(buffer);
  }
  if (data[0] === 0x50 && data[1] === 0x53 && data[2] === 0x47 && data[3] === 0x1A) {
    return parseBinaryPSG(data);
  }

  throw new Error('Unknown PSG format (expected binary "PSG"+0x1A or text "# PSG Dump")');
}

function parseBinaryPSG(data) {
  const frames = [];
  const regs = new Uint8Array(14);

  let pos = 16; // skip 16-byte header
  let inFrame = false;

  while (pos < data.length) {
    const byte = data[pos++];

    if (byte === 0xFD) break;

    if (byte === 0xFF) {
      if (inFrame) frames.push(new Uint8Array(regs));
      inFrame = true;
      continue;
    }

    if (byte === 0xFE) {
      if (inFrame) { frames.push(new Uint8Array(regs)); inFrame = false; }
      const count = (pos < data.length) ? data[pos++] * 4 : 0;
      for (let i = 0; i < count; i++) frames.push(new Uint8Array(regs));
      continue;
    }

    if (byte <= 0x0D && pos < data.length) {
      regs[byte] = data[pos++];
    }
  }

  if (inFrame) frames.push(new Uint8Array(regs));

  return { frames, totalFrames: frames.length, durationSeconds: frames.length / 50 };
}

function parseTextPSG(buffer) {
  const text = new TextDecoder().decode(buffer);
  const lines = text.split('\n');
  const frames = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse hex bytes: "5F 00 1D 01 7D 01 00 38 0E 0E 00 00 00 FF"
    const parts = trimmed.split(/\s+/);
    if (parts.length < 14) continue; // need at least 14 register values

    const regs = new Uint8Array(14);
    for (let i = 0; i < 14; i++) {
      regs[i] = parseInt(parts[i], 16);
      if (isNaN(regs[i])) { regs[i] = 0; }
    }
    frames.push(regs);
  }

  if (frames.length === 0) {
    throw new Error('No valid frames found in text PSG');
  }

  return { frames, totalFrames: frames.length, durationSeconds: frames.length / 50 };
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
