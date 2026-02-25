/**
 * PSG playback engine — sends register frames to ayumi AudioWorklet at 50 Hz.
 */
export class Player {
  constructor() {
    this.audioCtx = null;
    this.workletNode = null;
    this.gainNode = null;
    this.psg = null;          // parsed PSG data
    this.currentFrame = 0;
    this.playing = false;
    this.timer = null;
    this.onFrame = null;      // callback(frameNumber) for UI updates
    this.onEnd = null;        // callback() when playback ends
    this.startTime = 0;       // audioCtx.currentTime when playback started
    this.startFrame = 0;      // frame number when playback started
  }

  async init() {
    this.audioCtx = new AudioContext({ sampleRate: 44100 });

    if (!this.audioCtx.audioWorklet) {
      throw new Error('AudioWorklet not supported in this browser. Try Chrome or Edge.');
    }

    console.log('[player] loading worklet...');
    await this.audioCtx.audioWorklet.addModule('js/ayumi-worklet.js');
    console.log('[player] worklet loaded, creating node...');

    this.workletNode = new AudioWorkletNode(this.audioCtx, 'ayumi-audio-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    // GainNode for fade-in/out to prevent clicks
    this.gainNode = this.audioCtx.createGain();
    this.gainNode.gain.value = 0;
    this.workletNode.connect(this.gainNode);
    this.gainNode.connect(this.audioCtx.destination);

    // Configure: AY chip (not YM), ZX Spectrum clock 1.7734 MHz, sample rate, ABC stereo
    this.workletNode.port.postMessage({
      msg: 'configure',
      a: [false, 1773400, this.audioCtx.sampleRate, 'ABC'],
    });
    console.log('[player] configured, ready');
  }

  load(psg) {
    this.psg = psg;
    this.currentFrame = 0;
    this.stop();
  }

  play() {
    if (!this.psg || this.playing) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.playing = true;

    // Pre-send current frame's registers before unmuting (avoids initial click)
    this.sendFrame(this.currentFrame);
    this.workletNode.port.postMessage({ msg: 'unmute' });

    // Fade in over 30ms to prevent click
    const now = this.audioCtx.currentTime;
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + 0.03);

    this.startTime = now;
    this.startFrame = this.currentFrame;

    // Send frames at 50 Hz using audio clock for precision
    const frameDuration = 1 / 50; // 20ms

    const tick = () => {
      if (!this.playing) return;

      // Calculate which frame we should be on based on audio clock
      const elapsed = this.audioCtx.currentTime - this.startTime;
      const targetFrame = this.startFrame + Math.floor(elapsed / frameDuration);

      // Send any frames we've missed
      while (this.currentFrame <= targetFrame && this.currentFrame < this.psg.totalFrames) {
        this.sendFrame(this.currentFrame);
        this.currentFrame++;
      }

      if (this.currentFrame >= this.psg.totalFrames) {
        this.stop();
        if (this.onEnd) this.onEnd();
        return;
      }

      if (this.onFrame) this.onFrame(this.currentFrame);
      this.timer = requestAnimationFrame(tick);
    };

    this.timer = requestAnimationFrame(tick);
  }

  pause() {
    this.playing = false;
    if (this.timer) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
    // Fade out over 15ms then mute
    if (this.gainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.gainNode.gain.cancelScheduledValues(now);
      this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
      this.gainNode.gain.linearRampToValueAtTime(0, now + 0.015);
    }
    this.workletNode?.port.postMessage({ msg: 'stop' });
  }

  stop() {
    this.pause();
    this.currentFrame = 0;
    if (this.onFrame) this.onFrame(0);
  }

  seek(frame) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();

    this.currentFrame = Math.max(0, Math.min(frame, (this.psg?.totalFrames || 1) - 1));

    // Send the target frame so we hear the state at that position
    if (this.psg) this.sendFrame(this.currentFrame);
    if (this.onFrame) this.onFrame(this.currentFrame);

    if (wasPlaying) this.play();
  }

  sendFrame(frameNum) {
    if (!this.psg || frameNum >= this.psg.totalFrames) return;
    const regs = this.psg.frames[frameNum];
    this.workletNode.port.postMessage({
      msg: 'regs',
      a: Array.from(regs),
    });
  }

  get duration() {
    return this.psg ? this.psg.durationSeconds : 0;
  }

  get totalFrames() {
    return this.psg ? this.psg.totalFrames : 0;
  }
}
