import { readGenericDraft } from "./dom";
import type { SiteAdapter } from "./types";

/** Fallback for unknown pages: reads the draft from the focused or largest visible input, and no turns. */
export const genericAdapter: SiteAdapter = {
  site: "generic",
  readDraft: readGenericDraft,
  readTurns: () => [],
  conversationId: () => "new",
};
