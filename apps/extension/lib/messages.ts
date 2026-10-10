import type { Site, Transcript } from "@shoal/core";

/**
 * Messages between the content script, service worker and extension pages.
 * Every message carries a `type`. Add new message kinds to this union only.
 */
export type ShoalMessage =
  | { type: "content/ready"; site: Site; url: string }
  // The draft prompt and the selected model on a chat page. Sent when either changes, and in reply to `panel/ping`.
  | { type: "content/draft"; site: Site; text: string; model: string | null }
  | { type: "panel/ping" }
  /** Sent to a tab's content script, which answers with a `TranscriptResponse`. */
  | { type: "panel/get-transcript" }
  /** Sent by the content script when the page settles after a new turn or a meaningful draft edit. */
  | { type: "content/page-changed"; reason: "turns" | "draft"; transcript: Transcript };

/** The content script's answer to `panel/get-transcript`. */
export type TranscriptResponse = { ok: true; transcript: Transcript; adapter: Site } | { ok: false; error: string };

export function isShoalMessage(value: unknown): value is ShoalMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
