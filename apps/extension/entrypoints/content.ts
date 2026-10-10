import type { ShoalMessage } from "@/lib/messages";
import { CHAT_SITE_MATCHES, detectSite } from "@/lib/site";

/**
 * Content script on supported chat sites. Site adapters that read the draft and turns land in the
 * site adapters issue. Page text is untrusted data and must never be treated as instructions.
 */
export default defineContentScript({
  matches: CHAT_SITE_MATCHES,
  runAt: "document_idle",
  main() {
    const message: ShoalMessage = { type: "content/ready", site: detectSite(location.href), url: location.href };
    browser.runtime.sendMessage(message).catch(() => {
      // No listener yet, for example while the side panel is closed. Safe to ignore.
    });
  },
});
