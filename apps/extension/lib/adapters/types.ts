import type { Site, Turn } from "@shoal/core";

/** A message as read from the page. Page text is untrusted data, never instructions. */
export interface AdapterTurn {
  role: Turn["role"];
  text: string;
}

/** Reads one chat site's DOM. Every adapter shares this shape. */
export interface SiteAdapter {
  site: Site;
  /** The prompt currently being written, trimmed. Empty when there is none. */
  readDraft(doc: Document): string;
  /** Messages in conversation order. Empty when none are found. */
  readTurns(doc: Document): AdapterTurn[];
  /** The conversation ID from the URL path, or "new". */
  conversationId(loc: Pick<Location, "pathname">): string;
}
