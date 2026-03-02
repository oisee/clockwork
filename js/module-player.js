/**
 * Module playback engine for Clockwork.
 * Wraps the bitphase-derived AudioWorklet (pull-based, full pattern processing).
 * Same interface as Player: init, load, play, pause, stop, seek, onFrame, onEnd.
 */

// ======================================================================
// Data format conversion: ClockworkProject → worklet format
// ======================================================================

const NOTE_NAME_MAP = {
  'C': 2, 'C#': 3, 'D': 4, 'D#': 5, 'E': 6, 'F': 7,
  'F#': 8, 'G': 9, 'G#': 10, 'A': 11, 'A#': 12, 'B': 13
};

const EFFECT_TYPE_MAP = {
  'slide_up': 1,
  'slide_down': 2,
  'portamento': 80,  // 'P'
  'sample_pos': 4,
  'ornament_pos': 5,
  'on_off': 6,
  'speed': 83,       // 'S'
  'detune': 68,      // 'D'
};

function parseNoteForWorklet(noteStr) {
  if (!noteStr || noteStr === '---') return { name: 0, octave: 0 };
  if (noteStr === 'R--' || noteStr === 'OFF') return { name: 1, octave: 0 };

  let notePart, octave;
  if (noteStr.length >= 3 && noteStr[1] === '#') {
    notePart = noteStr.substring(0, 2);
    octave = parseInt(noteStr.substring(2)) || 1;
  } else if (noteStr.length >= 3 && noteStr[1] === '-') {
    notePart = noteStr[0];
    octave = parseInt(noteStr.substring(2)) || 1;
  } else {
    notePart = noteStr[0];
    octave = parseInt(noteStr.substring(1)) || 1;
  }

  return { name: NOTE_NAME_MAP[notePart] || 0, octave };
}

function convertEffectForWorklet(effect) {
  if (!effect) return null;
  if (effect.type === 'env_slide_up' || effect.type === 'env_slide_down') return null;
  const effectType = EFFECT_TYPE_MAP[effect.type];
  if (!effectType) return null;
  return { effect: effectType, delay: effect.delay || 0, parameter: effect.param || 0 };
}

function convertPatternForWorklet(cwPattern) {
  const numRows = cwPattern.length;
  const channels = cwPattern.channels.map(ch => ({
    rows: ch.rows.map(row => ({
      note: parseNoteForWorklet(row.note),
      instrument: row.instrument || 0,
      volume: row.volume || 0,
      table: row.ornament || 0,
      envelopeShape: row.envelopeShape || 0,
      effects: [convertEffectForWorklet(row.effect)]
    }))
  }));

  const patternRows = [];
  for (let i = 0; i < numRows; i++) {
    let envelopeEffect = null;
    for (let ch = 0; ch < 3; ch++) {
      const row = cwPattern.channels[ch]?.rows[i];
      if (row?.effect?.type === 'env_slide_up') {
        envelopeEffect = { effect: 1, delay: row.effect.delay || 0, parameter: row.effect.param || 0 };
      } else if (row?.effect?.type === 'env_slide_down') {
        envelopeEffect = { effect: 2, delay: row.effect.delay || 0, parameter: row.effect.param || 0 };
      }
    }
    patternRows.push({
      envelopeValue: cwPattern.globals?.envelopeValues?.[i] || 0,
      noiseValue: cwPattern.globals?.noiseValues?.[i] || 0,
      envelopeEffect
    });
  }

  return { id: cwPattern.id, length: numRows, channels, patternRows };
}

function convertInstrumentForWorklet(instrument) {
  return {
    id: instrument.id,
    rows: instrument.rows.map(r => ({
      tone: r.tone ?? false,
      noise: r.noise ?? false,
      envelope: r.envelope ?? false,
      toneAdd: r.toneAdd ?? 0,
      noiseAdd: r.noiseAdd ?? 0,
      volume: r.volume ?? 0,
      loop: r.loop ?? false,
      amplitudeSliding: r.amplitudeSliding ?? false,
      amplitudeSlideUp: r.amplitudeSlideUp ?? false,
      toneAccumulation: r.toneAccumulation ?? false,
      noiseAccumulation: r.noiseAccumulation ?? false,
      envelopeAdd: r.noiseAdd ?? 0,
      envelopeAccumulation: r.noiseAccumulation ?? false,
      retriggerEnvelope: false,
      alpha: (r.volume > 0 || r.envelope) ? 15 : 0
    })),
    loopPoint: instrument.loopPoint || 0
  };
}

// ======================================================================
// ModulePlayer
// ======================================================================

export class ModulePlayer {
  constructor() {
    this.audioCtx = null;
    this.workletNode = null;
    this.gainNode = null;
    this.project = null;
    this.unrolled = null;
    this.currentFrame = 0;
    this.playing = false;
    this.onFrame = null;
    this.onEnd = null;
    this.timer = null;
    this._positionToFrame = new Map();
    this._workletPatterns = new Map();
    this._wasmLoaded = false;
  }

  async init(audioCtx) {
    this.audioCtx = audioCtx;

    await this.audioCtx.audioWorklet.addModule('js/worklet/ayumi-processor.js');

    this.workletNode = new AudioWorkletNode(this.audioCtx, 'ayumi-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 0;
    this.workletNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    this.workletNode.port.onmessage = (event) => {
      this._handleWorkletMessage(event.data);
    };

    // Load WASM and send to worklet
    const wasmResponse = await fetch('js/worklet/ayumi.wasm');
    const wasmBuffer = await wasmResponse.arrayBuffer();
    this.workletNode.port.postMessage({ type: 'init', wasmBuffer });
    this._wasmLoaded = true;
  }

  load(project, unrolled) {
    this.project = project;
    this.unrolled = unrolled;
    this.currentFrame = 0;
    this.playing = false;

    // Pre-compute position-to-frame lookup
    this._positionToFrame.clear();
    for (const frame of unrolled.frames) {
      if (frame.isRowStart) {
        const key = `${frame.patternOrderIndex}:${frame.rowIndex}`;
        if (!this._positionToFrame.has(key)) {
          this._positionToFrame.set(key, frame.absoluteFrame);
        }
      }
    }

    // Convert all patterns to worklet format
    this._workletPatterns.clear();
    for (const pattern of project.patterns) {
      this._workletPatterns.set(pattern.id, convertPatternForWorklet(pattern));
    }

    // Send configuration to worklet
    const port = this.workletNode.port;
    port.postMessage({ type: 'init_tuning_table', tuningTable: project.tuningTable });
    port.postMessage({ type: 'init_speed', speed: project.initialSpeed });
    port.postMessage({ type: 'update_order', order: project.patternOrder });
    port.postMessage({
      type: 'init_tables',
      tables: project.tables.map(t => ({ id: t.id, rows: t.data, loop: t.loopPoint }))
    });
    port.postMessage({
      type: 'init_instruments',
      instruments: project.instruments.map(convertInstrumentForWorklet)
    });
    port.postMessage({ type: 'update_ay_frequency', aymFrequency: project.chipFrequency });
    port.postMessage({ type: 'update_int_frequency', intFrequency: project.interruptFrequency });

    // Send first pattern
    if (project.patternOrder.length > 0) {
      const firstPatternId = project.patternOrder[0];
      const pattern = this._workletPatterns.get(firstPatternId);
      if (pattern) {
        port.postMessage({ type: 'init_pattern', pattern, patternOrderIndex: 0 });
      }
    }
  }

  play() {
    if (!this.project || this.playing) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.playing = true;

    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + 0.03);

    if (this.currentFrame === 0) {
      this.workletNode.port.postMessage({
        type: 'play',
        startPatternOrderIndex: 0,
        initialSpeed: this.project.initialSpeed
      });
    } else {
      // Resume from current position with catch-up
      this._playFromFrame(this.currentFrame);
    }

    this._startFrameTracking();
  }

  pause() {
    this.playing = false;
    if (this.timer) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.015);
    }
    this.workletNode?.port.postMessage({ type: 'stop' });
  }

  stop() {
    this.pause();
    this.currentFrame = 0;
    if (this.onFrame) this.onFrame(0);
  }

  seek(frame) {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.playing = false;
      if (this.timer) {
        cancelAnimationFrame(this.timer);
        this.timer = null;
      }
      this.workletNode?.port.postMessage({ type: 'stop' });
    }

    this.currentFrame = Math.max(0, Math.min(frame, (this.unrolled?.totalFrames || 1) - 1));
    if (this.onFrame) this.onFrame(this.currentFrame);

    if (wasPlaying) {
      this.playing = true;
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(1, now + 0.03);

      this._playFromFrame(this.currentFrame);
      this._startFrameTracking();
    }
  }

  _playFromFrame(targetFrame) {
    if (!this.unrolled) return;

    const frameData = this.unrolled.frames[targetFrame];
    if (!frameData) return;

    const targetOrderIdx = frameData.patternOrderIndex;
    const targetRow = frameData.rowIndex;

    // Build catch-up segments: all complete patterns before the target
    const catchUpSegments = [];
    for (let i = 0; i < targetOrderIdx; i++) {
      const patternId = this.project.patternOrder[i];
      const pattern = this._workletPatterns.get(patternId);
      if (pattern) {
        catchUpSegments.push({ pattern, patternOrderIndex: i, numRows: pattern.length });
      }
    }

    const startPatternId = this.project.patternOrder[targetOrderIdx];
    const startPattern = this._workletPatterns.get(startPatternId);

    this.workletNode.port.postMessage({
      type: 'play_from_position',
      catchUpSegments,
      startPattern,
      startPatternOrderIndex: targetOrderIdx,
      startRow: targetRow,
      speed: this.project.initialSpeed
    });
  }

  _handleWorkletMessage(data) {
    switch (data.type) {
      case 'request_pattern': {
        const orderIndex = data.patternOrderIndex;
        if (orderIndex < this.project.patternOrder.length) {
          const patternId = this.project.patternOrder[orderIndex];
          const pattern = this._workletPatterns.get(patternId);
          if (pattern) {
            this.workletNode.port.postMessage({
              type: 'set_pattern_data',
              pattern,
              patternOrderIndex: orderIndex
            });
          }
        }
        break;
      }
      case 'position_update': {
        if (!this.playing) break;
        const key = `${data.currentPatternOrderIndex}:${data.currentRow}`;
        const base = this._positionToFrame.get(key);
        if (base !== undefined) {
          this.currentFrame = base + (data.currentTick || 0);
          if (this.onFrame) this.onFrame(this.currentFrame);
        }
        // Check for end of song
        if (this.unrolled && this.currentFrame >= this.unrolled.totalFrames - 1) {
          this.stop();
          if (this.onEnd) this.onEnd();
        }
        break;
      }
    }
  }

  _startFrameTracking() {
    // The worklet sends position_update messages for frame sync
    const tick = () => {
      if (!this.playing) return;
      this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  get duration() {
    return this.unrolled ? this.unrolled.durationSeconds : 0;
  }

  get totalFrames() {
    return this.unrolled ? this.unrolled.totalFrames : 0;
  }
}
