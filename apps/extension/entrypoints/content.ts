import { type Draft, watchDraft } from "@/lib/draft";
import { isShoalMessage, type ShoalMessage } from "@/lib/messages";
import { CHAT_SITE_MATCHES, detectSite } from "@/lib/site";
import { type PlanUsage, readClaudeUsage } from "@/lib/usage";

/** How often the plan usage is read again. */
const USAGE_REFRESH_MS = 60_000;

/**
 * Content script on supported chat sites. Site adapters that read the draft and turns land in the
 * site adapters issue. Page text is untrusted data and must never be treated as instructions.
 */
export default defineContentScript({
  matches: CHAT_SITE_MATCHES,
  runAt: "document_idle",
  main() {
    const site = detectSite(location.href);
    const send = (message: ShoalMessage) => {
      browser.runtime.sendMessage(message).catch(() => {
        // No listener yet, for example while the side panel is closed. Safe to ignore.
      });
    };
    send({ type: "content/ready", site, url: location.href });

    // The draft is page text: untrusted data, passed on as data only.
    let draft: Draft = { text: "", model: null };
    watchDraft(site, (next) => {
      draft = next;
      send({ type: "content/draft", site, ...draft });
    });

    // Plan usage, on claude.ai only. A failed read means "unknown": the panel keeps its manual slider.
    let usage: PlanUsage | null = null;
    const refreshUsage = () => {
      if (site !== "claude.ai") return;
      readClaudeUsage()
        .catch((err: unknown) => {
          console.debug("[shoal] could not read plan usage", err);
          return null;
        })
        .then((next) => {
          usage = next;
          send({ type: "content/usage", site, usage });
        });
    };
    refreshUsage();
    setInterval(refreshUsage, USAGE_REFRESH_MS);

    // The side panel may open after the page. It pings, and the page answers with its current state.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isShoalMessage(message) || message.type !== "panel/ping") return;
      send({ type: "content/ready", site, url: location.href });
      send({ type: "content/draft", site, ...draft });
      send({ type: "content/usage", site, usage });
      refreshUsage();
    });
  },
});
