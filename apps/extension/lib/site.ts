import type { Site } from "@shoal/core";

const HOSTS: Record<string, Site> = {
  "claude.ai": "claude.ai",
  "chatgpt.com": "chatgpt.com",
  "gemini.google.com": "gemini.google.com",
};

/** Maps a page URL to a supported chat site, or "generic" for anything else. */
export function detectSite(url: string): Site {
  try {
    return HOSTS[new URL(url).hostname] ?? "generic";
  } catch {
    return "generic";
  }
}

/** Match patterns for the content script and host permissions. Each must be justified in the store listing. */
export const CHAT_SITE_MATCHES = ["https://claude.ai/*", "https://chatgpt.com/*", "https://gemini.google.com/*"];
