import { sfx } from '../audio/sfx';
import type { VoiceActionType, WeaponId } from '../game/types';

function downsampleTo16kHz(input: Float32Array, inputSampleRate: number): Float32Array {
  if (inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.min(input.length, Math.round((offsetResult + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
      accum += input[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : input[Math.min(input.length - 1, offsetBuffer)];
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function float32ToPcm16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface LiveVoiceCallbacks {
  onStatusChange: (status: 'off' | 'connecting' | 'listening' | 'error', message?: string) => void;
  onVoiceAction: (action: VoiceActionType) => void;
  onTranscript?: (who: 'player' | 'ai', text: string) => void;
}

export class LiveVoiceClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private muteGain: GainNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private callbacks: LiveVoiceCallbacks;
  private active = false;

  constructor(callbacks: LiveVoiceCallbacks) {
    this.callbacks = callbacks;
  }

  public isActive(): boolean {
    return this.active;
  }

  public async start() {
    if (this.active) return;
    this.cleanupResources();
    this.callbacks.onStatusChange('connecting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.stream = stream;

      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws/live`);
      this.ws = ws;

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.type === 'live_ready') {
          this.active = true;
          this.callbacks.onStatusChange('listening');
          void this.beginMicCapture();
        } else if (msg.type === 'audio' && typeof msg.data === 'string') {
          sfx.enqueueLivePcm24k(msg.data);
        } else if (msg.type === 'interrupted') {
          sfx.stopLivePlayback();
        } else if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
          this.callbacks.onTranscript?.('player', msg.text);
        } else if (msg.type === 'output_transcript' && typeof msg.text === 'string') {
          this.callbacks.onTranscript?.('ai', msg.text);
        } else if (msg.type === 'voice_action') {
          const action = String(msg.action || '') as VoiceActionType;
          if (action === 'pulse' || action === 'reverse_spin' || action === 'cycle_gun') {
            this.callbacks.onVoiceAction(action);
          }
        } else if (msg.type === 'live_error') {
          const errText = String(msg.error || 'Gemini Live error');
          this.cleanupResources();
          this.callbacks.onStatusChange('error', errText);
        } else if (msg.type === 'live_closed') {
          if (this.active) {
            this.cleanupResources();
            this.callbacks.onStatusChange('off');
          }
        }
      };

      ws.onerror = () => {
        this.cleanupResources();
        this.callbacks.onStatusChange('error', 'Live voice WebSocket connection failed');
      };

      ws.onclose = () => {
        if (this.active) {
          this.cleanupResources();
          this.callbacks.onStatusChange('off');
        }
      };
    } catch (err) {
      this.cleanupResources();
      this.callbacks.onStatusChange(
        'error',
        err instanceof Error ? err.message : 'Microphone permission denied',
      );
    }
  }

  private async beginMicCapture() {
    if (!this.stream || !this.ws) return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    let inputCtx: AudioContext;
    let source: MediaStreamAudioSourceNode;
    try {
      inputCtx = new AudioCtx({ sampleRate: 16000 });
      source = inputCtx.createMediaStreamSource(this.stream);
    } catch {
      // Fallback for browsers/devices that disallow cross-rate MediaStreamAudioSourceNode
      inputCtx = new AudioCtx();
      source = inputCtx.createMediaStreamSource(this.stream);
    }

    if (inputCtx.state === 'suspended') {
      await inputCtx.resume();
    }

    this.inputCtx = inputCtx;
    const processor = inputCtx.createScriptProcessor(4096, 1, 1);
    const muteGain = inputCtx.createGain();
    muteGain.gain.value = 0; // Prevent local mic feedback echo out of speakers

    this.sourceNode = source;
    this.processor = processor;
    this.muteGain = muteGain;

    const actualRate = inputCtx.sampleRate;
    processor.onaudioprocess = (ev) => {
      if (!this.active || this.ws?.readyState !== WebSocket.OPEN) return;
      const rawChannel = ev.inputBuffer.getChannelData(0);
      const pcm16k = downsampleTo16kHz(rawChannel, actualRate);
      const pcmBase64 = float32ToPcm16Base64(pcm16k);
      this.ws.send(JSON.stringify({ audio: pcmBase64 }));
    };

    source.connect(processor);
    processor.connect(muteGain);
    muteGain.connect(inputCtx.destination);
  }

  private cleanupResources() {
    this.active = false;
    sfx.stopLivePlayback();

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    if (this.muteGain) {
      this.muteGain.disconnect();
      this.muteGain = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.inputCtx) {
      void this.inputCtx.close();
      this.inputCtx = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.ws) {
      const sock = this.ws;
      this.ws = null;
      sock.onmessage = null;
      sock.onerror = null;
      sock.onclose = null;
      if (sock.readyState === WebSocket.OPEN || sock.readyState === WebSocket.CONNECTING) {
        sock.close();
      }
    }
  }

  public stop() {
    this.cleanupResources();
    this.callbacks.onStatusChange('off');
  }
}
