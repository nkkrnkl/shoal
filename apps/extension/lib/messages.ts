import type { Site } from "@shoal/core";

/**
 * Messages between the content script, service worker and extension pages.
 * Every message carries a `type`. Add new message kinds to this union only.
 */
export type ShoalMessage =
  | { type: "content/ready"; site: Site; url: string }
  // The draft prompt and the selected model on a chat page. Sent when either changes, and in reply to `panel/ping`.
  | { type: "content/draft"; site: Site; text: string; model: string | null }
  | { type: "panel/ping" };

export function isShoalMessage(value: unknown): value is ShoalMessage {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}
