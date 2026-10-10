/**
 * Microphone capture for the voice orb. Only the loudness leaves this module; no audio is stored or sent anywhere.
 * Chrome's side panel cannot show the microphone prompt, so the first grant happens in a small extension tab
 * (entrypoints/permission). After that the side panel can open the microphone directly.
 */

/** The microphone has not been allowed for Shoal yet. */
export class MicPermissionError extends Error {
  override readonly name = "MicPermissionError";
}

export interface MicSession {
  /** Current loudness from 0 to 1. */
  level: () => number;
  stop: () => void;
}

/** Root mean square of a waveform, scaled so normal speech lands around 0.3 to 0.8. */
export function rmsLevel(samples: Float32Array, gain = 4): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.min(1, Math.sqrt(sum / samples.length) * gain);
}

export async function startMic(): Promise<MicSession> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      throw new MicPermissionError("Shoal needs permission to use the microphone.");
    }
    throw err;
  }
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  return {
    level: () => {
      analyser.getFloatTimeDomainData(buffer);
      return rmsLevel(buffer);
    },
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
      void ctx.close();
    },
  };
}

/** Opens the one-time permission tab. */
export function openMicPermissionPage(): void {
  void browser.tabs.create({ url: browser.runtime.getURL("/permission.html") });
}
