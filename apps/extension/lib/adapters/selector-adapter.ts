import type { Site } from "@shoal/core";
import { conversationIdFrom, firstMatch, readEditable, readGenericDraft, readTurnsWith } from "./dom";
import { SELECTORS } from "./selectors";
import type { SiteAdapter } from "./types";

/** Builds an adapter driven only by the site's entry in `SELECTORS`. Sites with quirks can override methods. */
export function createSelectorAdapter(site: Site): SiteAdapter {
  return {
    site,
    readDraft(doc) {
      const input = firstMatch(doc, SELECTORS[site].draft);
      // Fall back to the generic heuristic if the site's composer markup changed.
      return input ? readEditable(input) : readGenericDraft(doc);
    },
    readTurns: (doc) => readTurnsWith(doc, SELECTORS[site]),
    conversationId: (loc) => conversationIdFrom(loc.pathname, SELECTORS[site].conversationPath),
  };
}
