import { browser } from "wxt/browser";

const OFFSCREEN_PATH = "/offscreen.html";

/** Creates the offscreen document on demand for audio or WebAssembly work. */
export async function ensureOffscreen(): Promise<void> {
  const contexts = await browser.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [browser.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (contexts.length > 0) return;
  await browser.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ["WORKERS", "USER_MEDIA", "AUDIO_PLAYBACK"],
    justification: "Runs on-device model inference and voice audio, which cannot run in the service worker.",
  });
}
