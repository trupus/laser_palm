class SoundEffectsEngine {
  private ctx: AudioContext | null = null;
  private liveOutCtx: AudioContext | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private muted = false;

  private unlocked = false;

  constructor() {
    if (typeof window !== 'undefined') {
      const unlock = () => {
        this.unlocked = true;
        if (this.ctx && this.ctx.state === 'suspended') {
          void this.ctx.resume();
        }
      };
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });
    }
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      this.stopLivePlayback();
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private ensureCtx(): AudioContext | null {
    if (this.muted || !this.unlocked) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  private ensureLiveOutCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.liveOutCtx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.liveOutCtx = new AudioCtx({ sampleRate: 24000 });
      }
    }
    if (this.liveOutCtx && this.liveOutCtx.state === 'suspended') {
      void this.liveOutCtx.resume();
    }
    return this.liveOutCtx;
  }

  private makeNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleCount = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  public playLaserPulse(pointCount = 1, isCurved = false) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const pitchVar = 0.94 + Math.random() * 0.12;
    const baseFreq = Math.max(420, 1180 - pointCount * 65) * pitchVar;

    // Crisp sci-fi laser zap
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isCurved ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(115, now + 0.22);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);

    // Sub-harmonic thump
    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(240, now);
    sub.frequency.exponentialRampToValueAtTime(52, now + 0.16);
    sGain.gain.setValueAtTime(0.2, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    sub.connect(sGain).connect(ctx.destination);
    sub.start(now);
    sub.stop(now + 0.19);

    // Airy discharge transient
    const noise = ctx.createBufferSource();
    noise.buffer = this.makeNoiseBuffer(ctx, 0.11);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = isCurved ? 2400 : 1750;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.14, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    noise.connect(filter).connect(nGain).connect(ctx.destination);
    noise.start(now);
  }

  public playCooldownBlocked() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(195, now);
    osc.frequency.setValueAtTime(145, now + 0.04);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playSpinReverse() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.08);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  public playEnemyTelegraph() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(310, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.25);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.27);
  }

  public playHitmarker(killed = false) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(killed ? 980 : 1420, now);
    if (killed) {
      osc.frequency.setValueAtTime(1320, now + 0.055);
    }
    gain.gain.setValueAtTime(killed ? 0.2 : 0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (killed ? 0.16 : 0.05));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (killed ? 0.17 : 0.06));
  }

  public playHurt() {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.14);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  public playCountdownBeep(finalBeep = false) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(finalBeep ? 880 : 520, now);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (finalBeep ? 0.22 : 0.09));
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (finalBeep ? 0.24 : 0.1));
  }

  public async playWavBase64(base64Audio: string) {
    if (this.muted || !base64Audio) return;
    try {
      const audio = new Audio(`data:audio/wav;base64,${base64Audio}`);
      audio.volume = 0.85;
      await audio.play();
    } catch {
      // Ignore autoplay block before user interaction
    }
  }

  public enqueueLivePcm24k(base64Pcm: string) {
    const ctx = this.ensureLiveOutCtx();
    if (!ctx || !base64Pcm) return;

    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const startAt = Math.max(ctx.currentTime + 0.02, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };
  }

  public stopLivePlayback() {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        // Ignore stopped
      }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
  }
}

export const sfx = new SoundEffectsEngine();
