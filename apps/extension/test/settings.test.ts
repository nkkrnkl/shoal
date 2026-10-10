import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { getSettings, maskKey, onSettingsChanged, parseSettings, saveSettings } from "../lib/settings";

describe("settings", () => {
  beforeEach(() => fakeBrowser.reset());

  it("defaults to no key and the most accurate model", async () => {
    expect(await getSettings()).toEqual({ geminiApiKey: "", analyzerModel: "gemini-3.8-flash", autoAnalyze: true });
  });

  it("saves, trims and merges", async () => {
    await saveSettings({ geminiApiKey: "  AIzaKEY1234 " });
    await saveSettings({ analyzerModel: "gemini-3.5-flash-lite" });
    await saveSettings({ autoAnalyze: false });
    expect(await getSettings()).toEqual({
      geminiApiKey: "AIzaKEY1234",
      analyzerModel: "gemini-3.5-flash-lite",
      autoAnalyze: false,
    });
  });

  it("drops malformed values", () => {
    expect(parseSettings({ geminiApiKey: 42, analyzerModel: "gpt-9", autoAnalyze: "yes" })).toEqual({
      geminiApiKey: "",
      analyzerModel: "gemini-3.8-flash",
      autoAnalyze: true,
    });
    expect(parseSettings(null).geminiApiKey).toBe("");
  });

  it("notifies listeners on change", async () => {
    const callback = vi.fn();
    const stop = onSettingsChanged(callback);
    await saveSettings({ geminiApiKey: "k-new" });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ geminiApiKey: "k-new" }));
    stop();
  });

  it("masks keys for display", () => {
    expect(maskKey("AIzaSyABCDEF1234")).toBe("••••1234");
    expect(maskKey("abc")).toBe("••••");
  });
});
