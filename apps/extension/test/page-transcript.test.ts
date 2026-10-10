import { buildTranscript } from "@shoal/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_CONTENT_SCRIPT_ERROR, requestTranscript } from "../lib/page-transcript";

const transcript = buildTranscript({
  site: "chatgpt.com",
  conversationId: "abc",
  draft: "hi",
  turns: [{ role: "user", text: "hello" }],
  capturedAt: "2026-10-10T12:00:00.000Z",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestTranscript", () => {
  it("sends panel/get-transcript to the tab and returns the response", async () => {
    const send = vi
      .spyOn(browser.tabs, "sendMessage")
      .mockResolvedValue({ ok: true, transcript, adapter: "chatgpt.com" } as never);
    await expect(requestTranscript(7)).resolves.toEqual({ ok: true, transcript, adapter: "chatgpt.com" });
    expect(send).toHaveBeenCalledWith(7, { type: "panel/get-transcript" });
  });

  it("passes through an error from the content script", async () => {
    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue({ ok: false, error: "boom" } as never);
    await expect(requestTranscript(1)).resolves.toEqual({ ok: false, error: "boom" });
  });

  it.each([
    "Could not establish connection. Receiving end does not exist.",
    "The message port closed before a response was received.",
  ])("turns %j into a reload hint", async (message) => {
    vi.spyOn(browser.tabs, "sendMessage").mockRejectedValue(new Error(message));
    const r = await requestTranscript(1);
    expect(r).toEqual({ ok: false, error: NO_CONTENT_SCRIPT_ERROR });
    expect(NO_CONTENT_SCRIPT_ERROR).toMatch(/reload the tab/);
  });

  it("treats an empty response as no content script", async () => {
    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue(undefined as never);
    await expect(requestTranscript(1)).resolves.toEqual({ ok: false, error: NO_CONTENT_SCRIPT_ERROR });
  });

  it("rejects a malformed transcript", async () => {
    vi.spyOn(browser.tabs, "sendMessage").mockResolvedValue({ ok: true, transcript: { site: "x" } } as never);
    const r = await requestTranscript(1);
    expect(r.ok).toBe(false);
  });

  it("keeps other errors", async () => {
    vi.spyOn(browser.tabs, "sendMessage").mockRejectedValue(new Error("No tab with id: 99."));
    await expect(requestTranscript(99)).resolves.toEqual({ ok: false, error: "No tab with id: 99." });
  });
});
