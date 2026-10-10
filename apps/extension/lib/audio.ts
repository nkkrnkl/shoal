import { browser } from "wxt/browser";
import { INPUT_RATE, OUTPUT_RATE } from "@/lib/live";
import { rmsLevel } from "@/lib/mic";

function levelOf(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(scratch);
  return rmsLevel(scratch);
}

/** Captures the microphone as 16-bit PCM at 16 kHz, in blocks of 100 ms. */
export class MicCapture {
  private readonly scratch: Float32Array<ArrayBuffer>;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly analyser: AnalyserNode,
  ) {
    this.scratch = new Float32Array(analyser.fftSize);
  }

  /** Opens the microphone. Rejects with a `NotAllowedError` when Chrome has not been allowed to use it. */
  static async start(onBlock: (pcm: Int16Array) => void): Promise<MicCapture> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // A 16 kHz context makes the browser resample the microphone, so the worklet needs no resampler.
    const context = new AudioContext({ sampleRate: INPUT_RATE });
    await context.audioWorklet.addModule(browser.runtime.getURL("/pcm-capture.worklet.js"));
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const capture = new AudioWorkletNode(context, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => onBlock(new Int16Array(event.data));
    source.connect(analyser);
    source.connect(capture);
    return new MicCapture(stream, context, analyser);
  }

  /** How loud the microphone is right now, 0 to 1. */
  level(): number {
    return levelOf(this.analyser, this.scratch);
  }

  stop(): void {
    for (const track of this.stream.getTracks()) track.stop();
    void this.context.close();
  }
}

/** Plays the model's speech: 16-bit PCM at 24 kHz, queued block after block with no gaps. */
export class Speaker {
  private readonly context = new AudioContext({ sampleRate: OUTPUT_RATE });
  private readonly analyser = this.context.createAnalyser();
  private readonly scratch: Float32Array<ArrayBuffer>;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private nextStart = 0;

  constructor() {
    this.analyser.fftSize = 512;
    this.scratch = new Float32Array(this.analyser.fftSize);
    this.analyser.connect(this.context.destination);
  }

  play(pcm: Int16Array): void {
    if (pcm.length === 0) return;
    const buffer = this.context.createBuffer(1, pcm.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = (pcm[i] ?? 0) / 0x8000;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    source.onended = () => this.playing.delete(source);
    this.nextStart = Math.max(this.nextStart, this.context.currentTime);
    source.start(this.nextStart);
    this.nextStart += buffer.duration;
    this.playing.add(source);
  }

  /** Stops at once. Used when the user talks over the model. */
  flush(): void {
    for (const source of this.playing) source.stop();
    this.playing.clear();
    this.nextStart = 0;
  }

  get speaking(): boolean {
    return this.playing.size > 0;
  }

  /** How loud the speech is right now, 0 to 1. */
  level(): number {
    return levelOf(this.analyser, this.scratch);
  }

  close(): void {
    this.flush();
    void this.context.close();
  }
}
