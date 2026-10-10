import { type ContextAnalysis, MIN_DRAFT_CHARS, type Site, type Transcript } from "@shoal/core";
import { GEMINI_MODELS } from "@shoal/providers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextHealth, type ContextHealthState } from "@/components/ContextHealth";
import { Recommendation } from "@/components/Recommendation";
import { ShoalOrb } from "@/components/ShoalOrb";
import { Suggestions, type SuggestionsState } from "@/components/Suggestions";
import { loadSampleAnalysis } from "@/lib/fixtures";
import { runLiveAnalysis, runSuggestions } from "@/lib/live-analysis";
import { isShoalMessage } from "@/lib/messages";
import { requestTranscript } from "@/lib/page-transcript";
import { parsePastedConversation } from "@/lib/paste";
import { getSettings, onSettingsChanged, type Settings } from "@/lib/settings";
import { detectSite } from "@/lib/site";
import { useRecommendation } from "@/lib/use-recommendation";

type Mode = "live" | "paste" | "sample";
type PanelState = ContextHealthState | { status: "idle" };

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<Mode>("live");
  const [health, setHealth] = useState<PanelState>({ status: "idle" });
  const [tips, setTips] = useState<SuggestionsState>({ status: "idle" });
  const [newChat, setNewChat] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [pasted, setPasted] = useState("");
  const recommendation = useRecommendation();

  // Refs so message listeners always see current values.
  const settingsRef = useRef<Settings | null>(null);
  const modeRef = useRef<Mode>("live");
  const tabRef = useRef<number | undefined>(undefined);
  const analysisRef = useRef<{ conversationId: string; analysis: ContextAnalysis } | null>(null);
  const analysisRun = useRef(0);
  const tipsRun = useRef(0);

  settingsRef.current = settings;
  modeRef.current = mode;

  const suggest = useCallback((transcript: Transcript) => {
    const s = settingsRef.current;
    if (!s?.geminiApiKey) return;
    const id = ++tipsRun.current;
    if (transcript.draft.trim().length < MIN_DRAFT_CHARS) {
      setTips({ status: "idle" });
      return;
    }
    const prior = analysisRef.current;
    const analysis = prior?.conversationId === transcript.conversationId ? prior.analysis : undefined;
    setTips({ status: "loading" });
    runSuggestions(transcript, s, analysis)
      .then((out) => {
        if (id !== tipsRun.current) return;
        setTips({ status: "ready", suggestions: out.suggestions, transcript });
        setSessionCost((c) => c + out.usage.costUsd);
      })
      .catch((err: unknown) => {
        if (id === tipsRun.current) setTips({ status: "error", message: message(err) });
      });
  }, []);

  const analyze = useCallback(
    (transcript: Transcript) => {
      const s = settingsRef.current;
      if (!s?.geminiApiKey) return;
      const id = ++analysisRun.current;
      setNewChat(transcript.turns.length === 0);
      if (transcript.turns.length === 0) {
        // A new chat has nothing to prune yet; the draft can still get suggestions.
        analysisRef.current = null;
        setHealth({ status: "idle" });
        suggest(transcript);
        return;
      }
      setHealth({ status: "loading" });
      runLiveAnalysis(async () => transcript, s)
        .then(({ analysis }) => {
          if (id !== analysisRun.current) return;
          analysisRef.current = { conversationId: transcript.conversationId, analysis };
          setHealth({ status: "ready", analysis, transcript });
          setSessionCost((c) => c + analysis.usage.costUsd);
          suggest(transcript);
        })
        .catch((err: unknown) => {
          if (id === analysisRun.current) setHealth({ status: "error", message: message(err) });
        });
    },
    [suggest],
  );

  /** Reads the active tab now, for when the panel opens, the tab changes or the user asks. */
  const readActiveTab = useCallback(
    async (force: boolean) => {
      const tab = await activeTab();
      tabRef.current = tab?.id;
      setSite(tab?.url ? detectSite(tab.url) : null);
      const s = settingsRef.current;
      if (tab?.id === undefined || modeRef.current !== "live" || !s?.geminiApiKey) return;
      if (!s.autoAnalyze && !force) return;
      const res = await requestTranscript(tab.id);
      if (!res.ok) {
        setHealth({ status: "error", message: res.error });
        return;
      }
      analyze(res.transcript);
    },
    [analyze],
  );

  useEffect(() => {
    getSettings()
      .then((s) => {
        settingsRef.current = s;
        setSettings(s);
        void readActiveTab(false);
      })
      .catch(() => setSettings(null));
    const stopSettings = onSettingsChanged((s) => {
      const hadKey = Boolean(settingsRef.current?.geminiApiKey);
      settingsRef.current = s;
      setSettings(s);
      if (!hadKey && s.geminiApiKey) void readActiveTab(false);
    });

    const onMessage = (incoming: unknown, sender: { tab?: { id?: number } }) => {
      if (!isShoalMessage(incoming)) return;
      if (incoming.type === "content/ready" && sender.tab?.id === tabRef.current) setSite(incoming.site);
      if (incoming.type !== "content/page-changed") return;
      // Only the tab the user is looking at, only in live mode, only when running automatically.
      if (sender.tab?.id !== tabRef.current || modeRef.current !== "live" || !settingsRef.current?.autoAnalyze) return;
      if (incoming.reason === "turns") analyze(incoming.transcript);
      else suggest(incoming.transcript);
    };
    browser.runtime.onMessage.addListener(onMessage);
    const onActivated = () => void readActiveTab(false);
    browser.tabs.onActivated.addListener(onActivated);
    return () => {
      stopSettings();
      browser.runtime.onMessage.removeListener(onMessage);
      browser.tabs.onActivated.removeListener(onActivated);
    };
  }, [analyze, suggest, readActiveTab]);

  const analyzePasted = () => {
    const transcript = parsePastedConversation(pasted);
    if (!transcript) {
      setHealth({
        status: "error",
        message: 'Start each message with a speaker label, like "User:" or "Claude:", on its own line.',
      });
      return;
    }
    analyze(transcript);
  };

  const showSample = () => {
    const id = ++analysisRun.current;
    setHealth({ status: "loading" });
    loadSampleAnalysis()
      .then(({ analysis, transcript }) => {
        if (id === analysisRun.current) setHealth({ status: "ready", analysis, transcript });
      })
      .catch((err: unknown) => {
        if (id === analysisRun.current) setHealth({ status: "error", message: message(err) });
      });
  };

  const switchMode = (next: Mode) => {
    analysisRun.current++;
    tipsRun.current++;
    modeRef.current = next;
    setMode(next);
    setTips({ status: "idle" });
    setHealth({ status: "idle" });
    setNewChat(false);
    if (next === "sample") showSample();
    if (next === "live") void readActiveTab(true);
  };

  const openSettings = () => void browser.runtime.openOptionsPage();
  const hasKey = Boolean(settings?.geminiApiKey);
  const connected = site !== null && site !== "generic";
  const busy = health.status === "loading" || tips.status === "loading";
  const orbState = busy || recommendation.state.status === "loading" ? "thinking" : "idle";
  const retry = mode === "sample" ? showSample : mode === "paste" ? analyzePasted : () => void readActiveTab(true);
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
            : mode === "live" && settings?.autoAnalyze && hasKey
              ? `Watching ${site}. Shoal checks after each reply and while you type.`
              : `Connected to ${site}.`}
      </p>

      <div className="section-head">
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
        <button type="button" className="pill" onClick={openSettings}>
          Settings
        </button>
      </div>

      <section className="section" aria-labelledby="route-title">
        <h2 id="route-title">Model choice</h2>
        <Recommendation
          state={recommendation.state}
          settings={recommendation.settings}
          onSettingsChange={recommendation.setSettings}
        />
      </section>

      {mode !== "sample" && hasKey && (
        <section className="section" aria-labelledby="tips-title">
          <h2 id="tips-title">Your draft</h2>
          {tips.status === "idle" ? (
            <p className="muted">Start typing a message and Shoal will point out context the answer needs.</p>
          ) : (
            <Suggestions state={tips} />
          )}
        </section>
      )}

      <section className="section" aria-labelledby="health-title">
        <h2 id="health-title">Context health</h2>

        {mode === "live" && hasKey && (
          <button type="button" className="pill" disabled={!connected || busy} onClick={() => void readActiveTab(true)}>
            {health.status === "loading" ? "Analyzing…" : settings?.autoAnalyze ? "Analyze now" : "Analyze this chat"}
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
            <button type="button" className="pill" disabled={!pasted.trim() || busy} onClick={analyzePasted}>
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

        {newChat && mode === "live" && <p className="muted">New chat: nothing to prune yet.</p>}
        {shown && <ContextHealth state={shown} onOpenSettings={openSettings} onRetry={retry} />}
      </section>

      {settings && hasKey && sessionCost > 0 && (
        <p className="muted">
          {GEMINI_MODELS[settings.analyzerModel].label} · about ${sessionCost.toFixed(4)} this session · sent only to
          Google
        </p>
      )}
    </main>
  );
}
