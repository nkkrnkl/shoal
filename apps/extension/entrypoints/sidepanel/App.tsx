import type { Site } from "@shoal/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextHealth, type ContextHealthState } from "@/components/ContextHealth";
import { ShoalOrb } from "@/components/ShoalOrb";
import { loadSampleAnalysis } from "@/lib/fixtures";
import { isShoalMessage } from "@/lib/messages";
import { detectSite } from "@/lib/site";

// No analyzer client in the extension yet, so the panel starts without a key and offers sample data.
const NO_KEY: ContextHealthState = { status: "no-key" };

export function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [health, setHealth] = useState<ContextHealthState>(NO_KEY);
  const [showSample, setShowSample] = useState(false);
  const request = useRef(0);

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

  const loadSample = useCallback(() => {
    const id = ++request.current;
    setHealth({ status: "loading" });
    loadSampleAnalysis()
      .then(({ analysis, transcript }) => {
        if (id === request.current) setHealth({ status: "ready", analysis, transcript });
      })
      .catch((err: unknown) => {
        if (id === request.current)
          setHealth({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  const toggleSample = () => {
    if (showSample) {
      request.current++;
      setHealth(NO_KEY);
      setShowSample(false);
    } else {
      setShowSample(true);
      loadSample();
    }
  };

  const orbState = health.status === "loading" ? "thinking" : "idle";
  const connected = site !== null && site !== "generic";

  return (
    <main className="page">
      <header className="stage">
        <ShoalOrb state={orbState} />
        <div className="stage-top">
          <h1 className="wordmark">Shoal</h1>
          <span className="tag">
            state <b>{orbState}</b>
          </span>
        </div>
      </header>

      <p className="site-status" data-testid="site" data-connected={connected}>
        {site === null
          ? "Open a chat site to get started."
          : site === "generic"
            ? "This site is not supported yet."
            : `Connected to ${site}.`}
      </p>

      <section className="section" aria-labelledby="health-title">
        <div className="section-head">
          <h2 id="health-title">Context health</h2>
          <button type="button" className="pill" aria-pressed={showSample} onClick={toggleSample}>
            Show sample analysis
          </button>
        </div>

        {showSample && (
          <p className="sample-banner">
            <span className="tag">Sample data</span>
            <span>A made-up conversation, not your chat. Live analysis is not connected yet.</span>
          </p>
        )}

        <ContextHealth
          state={health}
          onOpenSettings={() => void browser.runtime.openOptionsPage()}
          onRetry={showSample ? loadSample : undefined}
        />
      </section>
    </main>
  );
}
