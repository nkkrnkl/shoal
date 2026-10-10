import { DEFAULT_GEMINI_MODEL, type GeminiModel, isGeminiModel } from "@shoal/providers";
import { browser } from "wxt/browser";

/**
 * User settings in chrome.storage.local. The API key never leaves the device except in requests to Google.
 * Local storage is not synced across devices, which is what we want for a secret.
 */

export interface Settings {
  geminiApiKey: string;
  analyzerModel: GeminiModel;
}

const KEY = "settings";
const DEFAULTS: Settings = { geminiApiKey: "", analyzerModel: DEFAULT_GEMINI_MODEL };

/** Reads stored settings, dropping anything malformed so a bad value cannot break the panel. */
export function parseSettings(value: unknown): Settings {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    geminiApiKey: typeof raw.geminiApiKey === "string" ? raw.geminiApiKey.trim() : DEFAULTS.geminiApiKey,
    analyzerModel:
      typeof raw.analyzerModel === "string" && isGeminiModel(raw.analyzerModel)
        ? raw.analyzerModel
        : DEFAULTS.analyzerModel,
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  return parseSettings(stored[KEY]);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = parseSettings({ ...(await getSettings()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

/** Calls back with the new settings whenever they change, for example after saving in the options page. */
export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    const change = changes[KEY];
    if (area === "local" && change) callback(parseSettings(change.newValue));
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Shows only the last four characters, for display. */
export function maskKey(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}
