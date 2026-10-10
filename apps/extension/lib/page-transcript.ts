import { SiteSchema, TranscriptSchema } from "@shoal/core";
import type { ShoalMessage, TranscriptResponse } from "./messages";

/** Shown when the tab has no Shoal content script to answer. */
export const NO_CONTENT_SCRIPT_ERROR =
  "Shoal can't read this tab. If it's a supported chat site (claude.ai, chatgpt.com or gemini.google.com), reload the tab and try again.";

/** Chrome's errors when no content script answers, for example on a tab opened before the extension loaded. */
const NO_RECEIVER = [/receiving end does not exist/i, /could not establish connection/i, /message port closed/i];

/** Asks the tab's content script for the current transcript. Never throws. */
export async function requestTranscript(tabId: number): Promise<TranscriptResponse> {
  const message: ShoalMessage = { type: "panel/get-transcript" };
  try {
    const response: unknown = await browser.tabs.sendMessage(tabId, message);
    return parseResponse(response);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (NO_RECEIVER.some((pattern) => pattern.test(text))) return { ok: false, error: NO_CONTENT_SCRIPT_ERROR };
    return { ok: false, error: text };
  }
}

function parseResponse(response: unknown): TranscriptResponse {
  if (response === undefined || response === null) return { ok: false, error: NO_CONTENT_SCRIPT_ERROR };
  const r = response as Partial<{ ok: boolean; error: string; adapter: string; transcript: unknown }>;
  if (r.ok === false) return { ok: false, error: typeof r.error === "string" ? r.error : "Unknown error" };
  const parsed = TranscriptSchema.safeParse(r.transcript);
  if (r.ok !== true || !parsed.success) return { ok: false, error: "The page sent an invalid transcript." };
  const adapter = SiteSchema.safeParse(r.adapter);
  return { ok: true, transcript: parsed.data, adapter: adapter.success ? adapter.data : parsed.data.site };
}
