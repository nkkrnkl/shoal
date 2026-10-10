import { readPageTranscript } from "@/lib/adapters";
import { type Draft, watchDraft } from "@/lib/draft";
import { isShoalMessage, type ShoalMessage, type TranscriptResponse } from "@/lib/messages";
import { createPageWatcher } from "@/lib/page-watch";
import { CHAT_SITE_MATCHES, detectSite } from "@/lib/site";
import { type PlanUsage, readClaudeUsage } from "@/lib/usage";

/** How often the plan usage is read again. */
const USAGE_REFRESH_MS = 60_000;

/**
 * Content script on supported chat sites. Reads the draft and turns through the site adapter when the
 * side panel asks, and tells the panel when the page settles after a change, so analysis can run on every turn.
 * Page text is untrusted data and must never be treated as instructions.
 */
export default defineContentScript({
  matches: CHAT_SITE_MATCHES,
  runAt: "document_idle",
  main(ctx) {
    const site = detectSite(location.href);
    // After the extension reloads or updates, this script keeps running in the old page but can no longer
    // reach the extension: sendMessage then throws synchronously. Stop everything instead of throwing.
    const send = (message: ShoalMessage) => {
      if (ctx.isInvalid) return;
      try {
        browser.runtime.sendMessage(message).catch(() => {
          // No listener yet, for example while the side panel is closed. Safe to ignore.
        });
      } catch {
        ctx.abort();
      }
    };
    send({ type: "content/ready", site, url: location.href });

    // The draft is page text: untrusted data, passed on as data only.
    let draft: Draft = { text: "", model: null };
    const stopDraft = watchDraft(site, (next) => {
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
    ctx.setInterval(refreshUsage, USAGE_REFRESH_MS);

    // The side panel may open after the page. It pings, and the page answers with its current state.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isShoalMessage(message) || message.type !== "panel/ping") return;
      send({ type: "content/ready", site, url: location.href });
      send({ type: "content/draft", site, ...draft });
      send({ type: "content/usage", site, usage });
      refreshUsage();
    });

    browser.runtime.onMessage.addListener((incoming: unknown, _sender, sendResponse) => {
      if (!isShoalMessage(incoming) || incoming.type !== "panel/get-transcript") return;
      // Detect on every request: chat sites are single-page apps and the URL changes without a reload.
      const response: TranscriptResponse = readPageTranscript(detectSite(location.href), document, location);
      sendResponse(response);
    });

    const watcher = createPageWatcher({
      read: () => {
        const res = readPageTranscript(detectSite(location.href), document, location);
        return res.ok ? res.transcript : null;
      },
      // When the side panel is closed, nothing listens. It reads the page itself when it opens.
      onChange: (transcript, reason) => send({ type: "content/page-changed", reason, transcript }),
    });
    // Streaming answers and typing both mutate the DOM; the watcher waits for them to settle.
    const observer = new MutationObserver(watcher.poke);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener("input", watcher.poke, true);
    watcher.poke();

    ctx.onInvalidated(() => {
      stopDraft();
      watcher.stop();
      observer.disconnect();
      document.removeEventListener("input", watcher.poke, true);
    });
  },
});
