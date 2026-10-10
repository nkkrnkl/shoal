// Audio worklet for the voice feature. It turns the microphone signal into 16-bit PCM and posts it
// to the page in blocks of 100 ms. The audio context runs at 16 kHz, so one block is 1600 samples.
const BLOCK = 1600;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      const sample = Math.max(-1, Math.min(1, value));
      this.block[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === BLOCK) {
        const full = this.block.slice();
        this.port.postMessage(full.buffer, [full.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
