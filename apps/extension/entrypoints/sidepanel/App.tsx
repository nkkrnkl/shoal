import type { Site, Transcript } from "@shoal/core";
import { GEMINI_MODELS } from "@shoal/providers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextHealth, type ContextHealthState } from "@/components/ContextHealth";
import { ShoalOrb } from "@/components/ShoalOrb";
import { loadSampleAnalysis } from "@/lib/fixtures";
import { AnalysisError, type LiveAnalysis, runLiveAnalysis } from "@/lib/live-analysis";
import { isShoalMessage } from "@/lib/messages";
import { requestTranscript } from "@/lib/page-transcript";
import { parsePastedConversation } from "@/lib/paste";
import { getSettings, onSettingsChanged, type Settings } from "@/lib/settings";
import { detectSite } from "@/lib/site";

type Mode = "live" | "paste" | "sample";
type PanelState = ContextHealthState | { status: "idle" };

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function pageTranscript(): Promise<Transcript> {
  const tab = await activeTab();
  if (tab?.id === undefined) throw new AnalysisError("No active tab to read.");
  const res = await requestTranscript(tab.id);
  if (!res.ok) throw new AnalysisError(res.error);
  return res.transcript;
}

export function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>("live");
  const [health, setHealth] = useState<PanelState>({ status: "idle" });
  const [cost, setCost] = useState<number | null>(null);
  const [pasted, setPasted] = useState("");
  const request = useRef(0);

  useEffect(() => {
    // Detect the site in the active tab when the panel opens.
    activeTab()
      .then((tab) => setSite(tab?.url ? detectSite(tab.url) : null))
      .catch(() => setSite(null));
    getSettings()
      .then(setSettings)
      .catch(() => setSettings(null));
    const stopSettings = onSettingsChanged(setSettings);

    const onMessage = (message: unknown) => {
      if (isShoalMessage(message) && message.type === "content/ready") setSite(message.site);
    };
    browser.runtime.onMessage.addListener(onMessage);
    const onActivated = () => {
      activeTab()
        .then((tab) => setSite(tab?.url ? detectSite(tab.url) : null))
        .catch(() => setSite(null));
    };
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      stopSettings();
      browser.runtime.onMessage.removeListener(onMessage);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, []);

  /** Runs one analysis; a newer run makes older results stale. */
  const run = useCallback((work: () => Promise<LiveAnalysis>) => {
    const id = ++request.current;
    setHealth({ status: "loading" });
    setCost(null);
    work()
      .then(({ analysis, transcript }) => {
        if (id !== request.current) return;
        setHealth({ status: "ready", analysis, transcript });
        setCost(analysis.usage.costUsd);
      })
      .catch((err: unknown) => {
        if (id === request.current)
          setHealth({ status: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  const analyzePage = () => settings && run(() => runLiveAnalysis(pageTranscript, settings));
  const analyzePasted = () => {
    if (!settings) return;
    run(async () => {
      const transcript = parsePastedConversation(pasted);
      if (!transcript) {
        throw new AnalysisError('Start each message with a speaker label, like "User:" or "Claude:", on its own line.');
      }
      return runLiveAnalysis(async () => transcript, settings);
    });
  };
  const showSample = () => run(loadSampleAnalysis);

  const switchMode = (next: Mode) => {
    request.current++;
    setMode(next);
    setCost(null);
    if (next === "sample") showSample();
    else setHealth({ status: "idle" });
  };

  const openSettings = () => void browser.runtime.openOptionsPage();
  const hasKey = Boolean(settings?.geminiApiKey);
  const connected = site !== null && site !== "generic";
  const orbState = health.status === "loading" ? "thinking" : "idle";
  const retry = mode === "sample" ? showSample : mode === "paste" ? analyzePasted : analyzePage;
  const shown: ContextHealthState | null =
    mode !== "sample" && !hasKey ? { status: "no-key" } : health.status === "idle" ? null : health;

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
            ? "This site is not supported yet. You can paste a conversation instead."
            : `Connected to ${site}.`}
      </p>

      <section className="section" aria-labelledby="health-title">
        <div className="section-head">
          <h2 id="health-title">Context health</h2>
          <button type="button" className="pill" onClick={openSettings}>
            Settings
          </button>
        </div>

        <fieldset className="field-actions mode-switch" aria-label="What to analyze">
          <button type="button" className="pill" aria-pressed={mode === "live"} onClick={() => switchMode("live")}>
            This chat
          </button>
          <button type="button" className="pill" aria-pressed={mode === "paste"} onClick={() => switchMode("paste")}>
            Paste
          </button>
          <button type="button" className="pill" aria-pressed={mode === "sample"} onClick={() => switchMode("sample")}>
            Sample
          </button>
        </fieldset>

        {mode === "live" && hasKey && (
          <button
            type="button"
            className="pill"
            disabled={!connected || health.status === "loading"}
            onClick={analyzePage}
          >
            {health.status === "loading" ? "Analyzing…" : "Analyze this chat"}
          </button>
        )}

        {mode === "paste" && hasKey && (
          <div className="paste">
            <textarea
              className="input"
              aria-label="Conversation to analyze"
              placeholder={"User: first message\nClaude: the reply\nUser: what you are about to send"}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              type="button"
              className="pill"
              disabled={!pasted.trim() || health.status === "loading"}
              onClick={analyzePasted}
            >
              Analyze pasted text
            </button>
          </div>
        )}

        {mode === "sample" && (
          <p className="sample-banner">
            <span className="tag">Sample data</span>
            <span>A made-up conversation, not your chat.</span>
          </p>
        )}

        {shown && <ContextHealth state={shown} onOpenSettings={openSettings} onRetry={retry} />}

        {cost !== null && settings && mode !== "sample" && (
          <p className="muted">
            Analyzed with {GEMINI_MODELS[settings.analyzerModel].label} for about ${cost.toFixed(4)}. The conversation
            was sent only to Google.
          </p>
        )}
      </section>
    </main>
  );
}
