import type { Site } from "@shoal/core";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import type { RecommendationState } from "@/components/Recommendation";
import { isShoalMessage, type ShoalMessage } from "@/lib/messages";
import { DEFAULT_ROUTER_URL, fetchRoute, type RouterSettings } from "@/lib/router";

/** Drafts shorter than this are not routed. */
const MIN_CHARS = 6;
/** The draft must stay unchanged this long before it is routed. */
const QUIET_MS = 700;

const BUDGET_KEY = "router.budget";
const SAVING_KEY = "router.savingForLater";
const URL_KEY = "router.url";

interface DraftState {
  site: Site;
  text: string;
  model: string | null;
}

/**
 * Follows the draft on the chat page and asks the Right-size router about it.
 * The draft arrives in `content/draft` messages. Settings are kept in `storage.local`.
 */
export function useRecommendation(): {
  state: RecommendationState;
  settings: RouterSettings;
  setSettings: (next: RouterSettings) => void;
} {
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [settings, setLocalSettings] = useState<RouterSettings>({ budget: 100, savingForLater: false });
  const [routerUrl, setRouterUrl] = useState(DEFAULT_ROUTER_URL);
  const [state, setState] = useState<RecommendationState>({ status: "idle" });

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (isShoalMessage(message) && message.type === "content/draft") {
        setDraft({ site: message.site, text: message.text, model: message.model });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    // The panel may open after the page: ask the active tab for its current draft.
    const ping: ShoalMessage = { type: "panel/ping" };
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => (tab?.id === undefined ? undefined : browser.tabs.sendMessage(tab.id, ping)))
      .catch(() => {
        // No content script in the active tab. The site status line already says so.
      });

    browser.storage.local
      .get({ [BUDGET_KEY]: 100, [SAVING_KEY]: false, [URL_KEY]: DEFAULT_ROUTER_URL })
      .then((stored) => {
        setLocalSettings({ budget: Number(stored[BUDGET_KEY]), savingForLater: Boolean(stored[SAVING_KEY]) });
        setRouterUrl(String(stored[URL_KEY]));
      })
      .catch(() => {
        // Keep the defaults.
      });

    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  const text = draft?.text ?? "";
  const site = draft?.site ?? "generic";
  const model = draft?.model ?? null;
  const { budget, savingForLater } = settings;

  useEffect(() => {
    if (text.length < MIN_CHARS) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState((previous) => (previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" }));
      fetchRoute({ text, site, model, budget, savingForLater }, { url: routerUrl, signal: controller.signal })
        .then((result) => setState({ status: "ready", result, refreshing: false }))
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
        });
    }, QUIET_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, site, model, budget, savingForLater, routerUrl]);

  const setSettings = (next: RouterSettings) => {
    setLocalSettings(next);
    void browser.storage.local.set({ [BUDGET_KEY]: next.budget, [SAVING_KEY]: next.savingForLater });
  };

  return { state, settings, setSettings };
}
