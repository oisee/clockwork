/**
 * Module parser for Clockwork.
 * Supports VT2 (Vortex Tracker II text format) and BTP (gzipped JSON).
 *
 * Entry point: parseModule(file) -> Promise<ClockworkProject>
 *
 * ClockworkProject = {
 *   name, author, initialSpeed, chipFrequency, interruptFrequency,
 *   patternOrder[], loopPoint, tuningTable[],
 *   patterns: [{ id, length, channels: [{rows: [{note, instrument, volume, ornament, envelopeShape, effect}]}],
 *                globals: {envelopeValues[], noiseValues[]} }],
 *   instruments[], tables[]
 * }
 */

// ======================================================================
// PT3 Tuning Tables (from Vortex Tracker II / Pro Tracker 3)
// ======================================================================

const PT3ToneTable_0 = [
  0x0c22, 0x0b73, 0x0acf, 0x0a33, 0x09a1, 0x0917, 0x0894, 0x0819, 0x07a4, 0x0737, 0x06cf, 0x066d,
  0x0611, 0x05ba, 0x0567, 0x051a, 0x04d0, 0x048b, 0x044a, 0x040c, 0x03d2, 0x039b, 0x0367, 0x0337,
  0x0308, 0x02dd, 0x02b4, 0x028d, 0x0268, 0x0246, 0x0225, 0x0206, 0x01e9, 0x01ce, 0x01b4, 0x019b,
  0x0184, 0x016e, 0x015a, 0x0146, 0x0134, 0x0123, 0x0112, 0x0103, 0x00f5, 0x00e7, 0x00da, 0x00ce,
  0x00c2, 0x00b7, 0x00ad, 0x00a3, 0x009a, 0x0091, 0x0089, 0x0082, 0x007a, 0x0073, 0x006d, 0x0067,
  0x0061, 0x005c, 0x0056, 0x0052, 0x004d, 0x0049, 0x0045, 0x0041, 0x003d, 0x003a, 0x0036, 0x0033,
  0x0031, 0x002e, 0x002b, 0x0029, 0x0027, 0x0024, 0x0022, 0x0020, 0x001f, 0x001d, 0x001b, 0x001a,
  0x0018, 0x0017, 0x0016, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d, 0x000c
];

const PT3ToneTable_1 = [
  0x0ef8, 0x0e10, 0x0d60, 0x0c80, 0x0bd8, 0x0b28, 0x0a88, 0x09f0, 0x0960, 0x08e0, 0x0858, 0x07e0,
  0x077c, 0x0708, 0x06b0, 0x0640, 0x05ec, 0x0594, 0x0544, 0x04f8, 0x04b0, 0x0470, 0x042c, 0x03fd,
  0x03be, 0x0384, 0x0358, 0x0320, 0x02f6, 0x02ca, 0x02a2, 0x027c, 0x0258, 0x0238, 0x0216, 0x01f8,
  0x01df, 0x01c2, 0x01ac, 0x0190, 0x017b, 0x0165, 0x0151, 0x013e, 0x012c, 0x011c, 0x010a, 0x00fc,
  0x00ef, 0x00e1, 0x00d6, 0x00c8, 0x00bd, 0x00b2, 0x00a8, 0x009f, 0x0096, 0x008e, 0x0085, 0x007e,
  0x0077, 0x0070, 0x006b, 0x0064, 0x005e, 0x0059, 0x0054, 0x004f, 0x004b, 0x0047, 0x0042, 0x003f,
  0x003b, 0x0038, 0x0035, 0x0032, 0x002f, 0x002c, 0x002a, 0x0027, 0x0025, 0x0023, 0x0021, 0x001f,
  0x001d, 0x001c, 0x001a, 0x0019, 0x0017, 0x0016, 0x0015, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f
];

const PT3ToneTable_2 = [
  0x0d10, 0x0c55, 0x0ba4, 0x0afc, 0x0a5f, 0x09ca, 0x093d, 0x08b8, 0x083b, 0x07c5, 0x0755, 0x06ec,
  0x0688, 0x062a, 0x05d2, 0x057e, 0x052f, 0x04e5, 0x049e, 0x045c, 0x041d, 0x03e2, 0x03ab, 0x0376,
  0x0344, 0x0315, 0x02e9, 0x02bf, 0x0298, 0x0272, 0x024f, 0x022e, 0x020f, 0x01f1, 0x01d5, 0x01bb,
  0x01a2, 0x018b, 0x0174, 0x0160, 0x014c, 0x0139, 0x0128, 0x0117, 0x0107, 0x00f9, 0x00eb, 0x00dd,
  0x00d1, 0x00c5, 0x00ba, 0x00b0, 0x00a6, 0x009d, 0x0094, 0x008c, 0x0084, 0x007c, 0x0075, 0x006f,
  0x0069, 0x0063, 0x005d, 0x0058, 0x0053, 0x004e, 0x004a, 0x0046, 0x0042, 0x003e, 0x003b, 0x0037,
  0x0034, 0x0031, 0x002f, 0x002c, 0x0029, 0x0027, 0x0025, 0x0023, 0x0021, 0x001f, 0x001d, 0x001c,
  0x001a, 0x0019, 0x0017, 0x0016, 0x0015, 0x0014, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d
];

const PT3ToneTable_3 = [
  0x0cda, 0x0c22, 0x0b73, 0x0acf, 0x0a33, 0x09a1, 0x0917, 0x0894, 0x0819, 0x07a4, 0x0737, 0x06cf,
  0x066d, 0x0611, 0x05ba, 0x0567, 0x051a, 0x04d0, 0x048b, 0x044a, 0x040c, 0x03d2, 0x039b, 0x0367,
  0x0337, 0x0308, 0x02dd, 0x02b4, 0x028d, 0x0268, 0x0246, 0x0225, 0x0206, 0x01e9, 0x01ce, 0x01b4,
  0x019b, 0x0184, 0x016e, 0x015a, 0x0146, 0x0134, 0x0123, 0x0112, 0x0103, 0x00f5, 0x00e7, 0x00da,
  0x00ce, 0x00c2, 0x00b7, 0x00ad, 0x00a3, 0x009a, 0x0091, 0x0089, 0x0082, 0x007a, 0x0073, 0x006d,
  0x0067, 0x0061, 0x005c, 0x0056, 0x0052, 0x004d, 0x0049, 0x0045, 0x0041, 0x003d, 0x003a, 0x0036,
  0x0033, 0x0031, 0x002e, 0x002b, 0x0029, 0x0027, 0x0024, 0x0022, 0x0020, 0x001f, 0x001d, 0x001b,
  0x001a, 0x0018, 0x0017, 0x0016, 0x0014, 0x0013, 0x0012, 0x0011, 0x0010, 0x000f, 0x000e, 0x000d
];

const PT3ToneTable_4 = [
  2880, 2700, 2560, 2400, 2304, 2160, 2025, 1920, 1800, 1728, 1620, 1536, 1440, 1350, 1280, 1200,
  1152, 1080, 1013, 960, 900, 864, 810, 768, 720, 675, 640, 600, 576, 540, 506, 480, 450, 432,
  405, 384, 360, 338, 320, 300, 288, 270, 253, 240, 225, 216, 203, 192, 180, 169, 160, 150, 144,
  135, 127, 120, 113, 108, 101, 96, 90, 84, 80, 75, 72, 68, 63, 60, 56, 54, 51, 48, 45, 42, 40,
  38, 36, 34, 32, 30, 28, 27, 25, 24, 23, 21, 20, 19, 18, 17, 16, 15, 14, 14, 13, 12
];

const PT3TuneTables = [PT3ToneTable_0, PT3ToneTable_1, PT3ToneTable_2, PT3ToneTable_3, PT3ToneTable_4];

function generate12TETTuningTable(chipFrequencyHz, a4Hz = 440) {
  const result = [];
  for (let i = 0; i < 96; i++) {
    const freqHz = a4Hz * Math.pow(2, (i - 45) / 12);
    let period = Math.round(chipFrequencyHz / 16 / freqHz);
    result.push(Math.max(1, Math.min(4095, period)));
  }
  return result;
}

// ======================================================================
// VT2 Parser Helpers
// ======================================================================

function extractSection(lines, sectionName) {
  const content = [];
  let inSection = false;
  for (const line of lines) {
    if (line === sectionName) { inSection = true; continue; }
    if (line.startsWith('[') && line !== sectionName) { inSection = false; continue; }
    if (inSection && line) content.push(line);
  }
  return content;
}

function extractSections(lines, pattern) {
  const sections = [];
  let currentMatch = null;
  let currentContent = [];

  for (const line of lines) {
    if (line === '[Module]') {
      if (currentMatch) {
        sections.push({ match: currentMatch, content: currentContent });
        currentMatch = null;
        currentContent = [];
      }
      continue;
    }
    const match = line.match(pattern);
    if (match) {
      if (currentMatch) sections.push({ match: currentMatch, content: currentContent });
      currentMatch = match;
      currentContent = [];
      continue;
    }
    if (currentMatch) {
      if (line && !line.startsWith('[')) {
        currentContent.push(line);
      } else if (line.startsWith('[')) {
        sections.push({ match: currentMatch, content: currentContent });
        currentMatch = null;
        currentContent = [];
      }
    }
  }
  if (currentMatch) sections.push({ match: currentMatch, content: currentContent });
  return sections;
}

function parseHexDigit(char) {
  if (char === '.') return 0;
  if (char >= '0' && char <= '9') return parseInt(char);
  if (char >= 'A' && char <= 'F') return char.charCodeAt(0) - 65 + 10;
  if (char >= 'a' && char <= 'f') return char.charCodeAt(0) - 97 + 10;
  return 0;
}

function parseBase36Digit(char) {
  if (!char || char === '.') return 0;
  const upper = char.toUpperCase();
  if (upper >= '0' && upper <= '9') return parseInt(upper, 10);
  if (upper >= 'A' && upper <= 'Z') return upper.charCodeAt(0) - 65 + 10;
  return 0;
}

function parseSignedHex(str) {
  const cleaned = str.replace(/[+_^-]/g, '');
  const value = parseInt(cleaned, 16) || 0;
  return str.includes('-') ? -value : value;
}

function parseHexValue(str, length) {
  if (str.length < length) return 0;
  const hex = str.substring(0, length).replace(/\./g, '0');
  return parseInt(hex, 16) || 0;
}

// ======================================================================
// VT2 Section Parsers
// ======================================================================

function parseModuleHeader(lines) {
  const mod = {
    title: '', author: '', version: '', speed: 3,
    playOrder: [], loopPoint: 0, noteTable: 0,
    customNoteTable: null,
    chipFrequency: 1773400, interruptFrequency: 50
  };

  const sectionLines = extractSection(lines, '[Module]');

  for (const line of sectionLines) {
    const eqIndex = line.indexOf('=');
    if (eqIndex < 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    switch (key) {
      case 'Title': mod.title = value; break;
      case 'Author': mod.author = value; break;
      case 'Version': mod.version = value; break;
      case 'Speed': mod.speed = parseInt(value) || 3; break;
      case 'PlayOrder': {
        const { patternOrder, loopPoint } = parsePlayOrderStr(value);
        mod.playOrder = patternOrder;
        mod.loopPoint = loopPoint;
        break;
      }
      case 'NoteTable': mod.noteTable = parseInt(value) || 0; break;
      case 'CustomNoteTable': {
        const parts = value.split(',').map(p => parseInt(p.trim(), 10));
        if (parts.length >= 96 && parts.every(n => !isNaN(n))) {
          mod.customNoteTable = parts.slice(0, 96);
        }
        break;
      }
      case 'ChipFreq': mod.chipFrequency = parseInt(value) || 1773400; break;
      case 'IntFreq': {
        const raw = parseInt(value) || 50;
        mod.interruptFrequency = raw >= 1000 ? raw / 1000 : raw;
        break;
      }
    }
  }

  return mod;
}

function parsePlayOrderStr(orderString) {
  const parts = orderString.split(',').map(part => part.trim());
  const patternOrder = [];
  let loopPoint = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('L')) {
      loopPoint = i;
      const idx = parseInt(part.substring(1));
      if (!isNaN(idx)) patternOrder.push(idx);
    } else {
      const idx = parseInt(part);
      if (!isNaN(idx)) patternOrder.push(idx);
    }
  }

  return { patternOrder, loopPoint };
}

function parseOrnaments(lines) {
  const tables = [];
  const tableSections = extractSections(lines, /^\[Ornament(\d+)\]$/);

  for (const { match, content } of tableSections) {
    const id = parseInt(match[1]);
    const table = { id, data: [], loop: false, loopPoint: 0 };

    for (const line of content) {
      for (const value of line.split(',').map(v => v.trim())) {
        if (value.startsWith('L')) {
          table.loop = true;
          table.loopPoint = table.data.length;
          const num = parseInt(value.substring(1));
          if (!isNaN(num)) table.data.push(num);
        } else {
          const num = parseInt(value);
          if (!isNaN(num)) table.data.push(num);
        }
      }
    }

    tables.push(table);
  }

  return tables;
}

function parseSamples(lines) {
  const samples = [];
  const sampleSections = extractSections(lines, /^\[Sample([0-9]+|[A-Za-z])\]$/i);

  for (const { match, content } of sampleSections) {
    const idStr = match[1].toUpperCase();
    const id = /^[0-9]+$/.test(idStr) ? parseInt(idStr, 10) : parseBase36Digit(idStr);
    samples.push({
      id,
      data: content.map(parseSampleLine).filter(Boolean)
    });
  }

  return samples;
}

function parseSampleLine(line) {
  const parts = line.split(/\s+/);
  if (parts.length < 4) return null;

  const [flags, toneStr, noiseStr, volumeStr, ...rest] = parts;

  const toneAccumulation = toneStr.includes('^');
  const toneValue = parseSignedHex(toneStr.replace('^', ''));
  const noiseAccumulation = noiseStr.includes('^');
  const noiseValue = parseSignedHex(noiseStr.replace('^', ''));

  const volumeCleaned = volumeStr.replace('_', '');
  const hasAmplitudeSliding = volumeCleaned.includes('+') || volumeCleaned.includes('-');
  const amplitudeSlideUp = volumeCleaned.includes('+');
  const volumeValue = parseInt(volumeCleaned.replace(/[+-]/g, ''), 16) || 0;

  return {
    tone: flags.includes('T'),
    noise: flags.includes('N'),
    envelope: flags.includes('E'),
    toneAdd: toneValue,
    noiseAdd: noiseValue,
    volume: volumeValue,
    loop: rest.includes('L'),
    amplitudeSliding: hasAmplitudeSliding,
    amplitudeSlideUp,
    toneAccumulation,
    noiseAccumulation
  };
}

// ======================================================================
// VT2 Pattern Parsing
// ======================================================================

const EFFECT_TYPES = {
  '1': 'slide_up',
  '2': 'slide_down',
  '3': 'portamento',
  '4': 'sample_pos',
  '5': 'ornament_pos',
  '6': 'on_off',
  '9': 'env_slide_up',
  'A': 'env_slide_down',
  'B': 'speed',
  'D': 'detune'
};

function parseEffect(effectsStr) {
  const trimmed = effectsStr.trim();
  if (!trimmed || trimmed[0] === '.' || trimmed.length > 4) return null;

  const typeChar = trimmed[0];
  const type = EFFECT_TYPES[typeChar];
  if (!type) return null;

  let delay = 0, param = 0;

  if (trimmed.length === 3) {
    param = parseInt(trimmed.slice(1, 3).replace(/\./g, '0'), 16) || 0;
  } else if (trimmed.length === 4) {
    delay = parseHexDigit(trimmed[1]);
    const p1 = trimmed[2] !== '.' ? parseHexDigit(trimmed[2]) : 0;
    const p2 = trimmed[3] !== '.' ? parseHexDigit(trimmed[3]) : 0;
    param = (p1 << 4) | p2;
  }

  return { type, delay, param };
}

function parseChannelData(data) {
  const parts = data.split(/\s+/);
  const [note = '', sampleAndVol = '', ...effectParts] = parts;
  const effectsStr = effectParts.join(' ');

  let instrument = 0, volume = 0, ornament = 0, envelopeShape = 0;

  if (sampleAndVol.length >= 4) {
    instrument = parseBase36Digit(sampleAndVol[0]);
    envelopeShape = parseHexDigit(sampleAndVol[1]);
    ornament = parseHexDigit(sampleAndVol[2]);
    volume = parseHexDigit(sampleAndVol[3]);
  }

  return { note, instrument, volume, ornament, envelopeShape, effect: parseEffect(effectsStr) };
}

function parsePatternRow(line) {
  const channels = line.split('|');
  if (channels.length < 4) return { channelRows: null, envelopeValue: 0, noiseValue: 0 };

  const [envelopePart, noisePart, ...channelParts] = channels;
  return {
    channelRows: channelParts.map(ch => parseChannelData(ch.trim())),
    envelopeValue: parseHexValue(envelopePart, 4),
    noiseValue: parseHexValue(noisePart, 2)
  };
}

function parseVT2Patterns(lines) {
  const patterns = [];
  const patternSections = extractSections(lines, /^\[Pattern(\d+)\]$/);

  for (const { match, content } of patternSections) {
    const id = parseInt(match[1]);
    const rows = [], envelopeValues = [], noiseValues = [];

    for (const line of content) {
      const { channelRows, envelopeValue, noiseValue } = parsePatternRow(line);
      if (channelRows) {
        rows.push(channelRows);
        envelopeValues.push(envelopeValue);
        noiseValues.push(noiseValue);
      }
    }

    patterns.push({ id, rows, envelopeValues, noiseValues });
  }

  return patterns;
}

// ======================================================================
// VT2 -> ClockworkProject
// ======================================================================

function resolveTuningTable(mod) {
  if (mod.noteTable >= 0 && mod.noteTable < PT3TuneTables.length) {
    return [...PT3TuneTables[mod.noteTable]];
  }
  if (mod.noteTable === 5) {
    if (mod.customNoteTable && mod.customNoteTable.length === 96 &&
        mod.customNoteTable.every(n => n >= 1 && n <= 4095)) {
      return [...mod.customNoteTable];
    }
    return generate12TETTuningTable(mod.chipFrequency, 440);
  }
  return [...PT3TuneTables[2]];
}

const EMPTY_ROW = { note: '---', instrument: 0, volume: 0, ornament: 0, envelopeShape: 0, effect: null };

function parseVT2(content) {
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').map(line => line.trim());

  const mod = parseModuleHeader(lines);
  const ornaments = parseOrnaments(lines);
  const samples = parseSamples(lines);
  const rawPatterns = parseVT2Patterns(lines);
  const tuningTable = resolveTuningTable(mod);

  // Transpose raw patterns from [row][channel] to [channel][row]
  const patterns = rawPatterns.map(raw => {
    const numRows = raw.rows.length;
    const channels = [{ rows: [] }, { rows: [] }, { rows: [] }];

    for (let r = 0; r < numRows; r++) {
      for (let ch = 0; ch < 3; ch++) {
        channels[ch].rows.push(raw.rows[r][ch] || { ...EMPTY_ROW });
      }
    }

    return {
      id: raw.id,
      length: numRows,
      channels,
      globals: { envelopeValues: raw.envelopeValues, noiseValues: raw.noiseValues }
    };
  });

  // Convert instruments (samples)
  const instruments = samples.map(sample => {
    let loopPoint = 0;
    for (let i = 0; i < sample.data.length; i++) {
      if (sample.data[i].loop) { loopPoint = i; break; }
    }
    return {
      id: typeof sample.id === 'string' ? sample.id
        : sample.id.toString(36).toUpperCase().padStart(2, '0'),
      rows: sample.data,
      loopPoint
    };
  });

  // Convert ornament tables
  const tables = ornaments.map(t => ({
    id: t.id - 1,
    data: t.data,
    loopPoint: t.loop ? t.loopPoint : 0
  }));

  return {
    name: mod.title,
    author: mod.author,
    initialSpeed: mod.speed >= 1 && mod.speed <= 255 ? mod.speed : 3,
    chipFrequency: mod.chipFrequency,
    interruptFrequency: mod.interruptFrequency,
    patternOrder: mod.playOrder,
    loopPoint: mod.loopPoint || 0,
    tuningTable,
    patterns,
    instruments,
    tables
  };
}

// ======================================================================
// BTP Loader (gzipped JSON)
// ======================================================================

async function parseBTP(buffer) {
  const ds = new DecompressionStream('gzip');
  const blob = new Blob([buffer]);
  const stream = blob.stream().pipeThrough(ds);
  const decompressed = await new Response(stream).text();
  const json = JSON.parse(decompressed);

  return {
    name: json.name || json.title || 'Untitled',
    author: json.author || '',
    initialSpeed: json.initialSpeed || json.speed || 3,
    chipFrequency: json.chipFrequency || json.chipFreq || 1773400,
    interruptFrequency: json.interruptFrequency || json.intFreq || 50,
    patternOrder: json.patternOrder || json.playOrder || [],
    loopPoint: json.loopPoint || 0,
    tuningTable: json.tuningTable || [...PT3TuneTables[2]],
    patterns: (json.patterns || []).map(p => ({
      id: p.id,
      length: p.length || (p.channels?.[0]?.rows?.length) || 64,
      channels: (p.channels || []).map(ch => ({
        rows: (ch.rows || []).map(r => ({
          note: r.note || '---',
          instrument: r.instrument || 0,
          volume: r.volume || 0,
          ornament: r.ornament || 0,
          envelopeShape: r.envelopeShape || 0,
          effect: r.effect || null
        }))
      })),
      globals: p.globals || { envelopeValues: [], noiseValues: [] }
    })),
    instruments: json.instruments || [],
    tables: json.tables || []
  };
}

// ======================================================================
// Entry point
// ======================================================================

export async function parseModule(file) {
  const ext = file.name.toLowerCase().split('.').pop();

  if (ext === 'vt2') {
    const content = await file.text();
    return parseVT2(content);
  }

  if (ext === 'btp') {
    const buffer = await file.arrayBuffer();
    return parseBTP(buffer);
  }

  throw new Error(`Unsupported module format: .${ext}`);
}
