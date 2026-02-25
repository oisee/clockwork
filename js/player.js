/**
 * PSG playback engine — sends register frames to ayumi AudioWorklet at 50 Hz.
 */
export class Player {
  constructor() {
    this.audioCtx = null;
    this.workletNode = null;
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
    await this.audioCtx.audioWorklet.addModule('js/ayumi-worklet.js');
    this.workletNode = new AudioWorkletNode(this.audioCtx, 'ayumi-audio-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.workletNode.connect(this.audioCtx.destination);

    // Configure: AY chip (not YM), ZX Spectrum clock 1.7734 MHz, sample rate, ABC stereo
    this.workletNode.port.postMessage({
      msg: 'configure',
      a: [false, 1773400, this.audioCtx.sampleRate, 'ABC'],
    });
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
    this.startTime = this.audioCtx.currentTime;
    this.startFrame = this.currentFrame;

    // Unmute the worklet
    this.workletNode.port.postMessage({ msg: 'unmute' });

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
    this.workletNode.port.postMessage({ msg: 'stop' });
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
