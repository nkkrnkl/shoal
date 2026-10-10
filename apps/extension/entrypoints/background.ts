import { isShoalMessage } from "@/lib/messages";

/**
 * MV3 service worker. Chrome stops it when idle, so it holds no long-lived state:
 * no WebSockets, audio or model inference. Those run in the side panel or the offscreen document.
 */
export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err: unknown) => {
    console.error("[shoal] could not set side panel behavior", err);
  });

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!isShoalMessage(message)) return;
    // Extension pages receive runtime messages directly. Routing logic grows here.
    if (message.type === "content/ready") {
      console.debug("[shoal] content script ready on", message.site);
    }
  });
});
