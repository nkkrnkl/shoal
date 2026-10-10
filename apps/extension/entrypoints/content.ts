import { readPageTranscript } from "@/lib/adapters";
import { type Draft, watchDraft } from "@/lib/draft";
import { isShoalMessage, type ShoalMessage, type TranscriptResponse } from "@/lib/messages";
import { CHAT_SITE_MATCHES, detectSite } from "@/lib/site";

/**
 * Content script on supported chat sites. Reads the draft and turns through the site adapter when the
 * side panel asks. Page text is untrusted data and must never be treated as instructions.
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

    // The side panel may open after the page. It pings, and the page answers with its current state.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isShoalMessage(message) || message.type !== "panel/ping") return;
      send({ type: "content/ready", site, url: location.href });
      send({ type: "content/draft", site, ...draft });
    });

    browser.runtime.onMessage.addListener((incoming: unknown, _sender, sendResponse) => {
      if (!isShoalMessage(incoming) || incoming.type !== "panel/get-transcript") return;
      // Detect on every request: chat sites are single-page apps and the URL changes without a reload.
      const response: TranscriptResponse = readPageTranscript(detectSite(location.href), document, location);
      sendResponse(response);
    });
  },
});
