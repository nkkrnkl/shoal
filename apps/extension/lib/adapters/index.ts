import { buildTranscript, type Site } from "@shoal/core";
import type { TranscriptResponse } from "../messages";
import { chatgptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { geminiAdapter } from "./gemini";
import { genericAdapter } from "./generic";
import type { SiteAdapter } from "./types";

export type { AdapterTurn, SiteAdapter } from "./types";

const ADAPTERS: Record<Site, SiteAdapter> = {
  "claude.ai": claudeAdapter,
  "chatgpt.com": chatgptAdapter,
  "gemini.google.com": geminiAdapter,
  generic: genericAdapter,
};

export function getAdapter(site: Site): SiteAdapter {
  return ADAPTERS[site];
}

/** Reads the current page into a transcript. A page with no turns gives zero turns; only a thrown error fails. */
export function readPageTranscript(site: Site, doc: Document, loc: Pick<Location, "pathname">): TranscriptResponse {
  const adapter = getAdapter(site);
  try {
    const transcript = buildTranscript({
      site: adapter.site,
      conversationId: adapter.conversationId(loc),
      draft: adapter.readDraft(doc),
      turns: adapter.readTurns(doc),
    });
    return { ok: true, transcript, adapter: adapter.site };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
