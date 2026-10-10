import type { Site } from "@shoal/core";
import { useEffect, useState } from "react";
import { isShoalMessage } from "@/lib/messages";
import { detectSite } from "@/lib/site";

export function App() {
  const [site, setSite] = useState<Site | null>(null);

  useEffect(() => {
    // Detect the site in the active tab when the panel opens.
    browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => setSite(tab?.url ? detectSite(tab.url) : null))
      .catch(() => setSite(null));

    const onMessage = (message: unknown) => {
      if (isShoalMessage(message) && message.type === "content/ready") setSite(message.site);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1 style={{ fontSize: 20, margin: 0 }}>Hello Shoal</h1>
      <p data-testid="site">
        {site === null
          ? "Open a chat site to get started."
          : site === "generic"
            ? "This site is not supported yet."
            : `Connected to ${site}.`}
      </p>
    </main>
  );
}
