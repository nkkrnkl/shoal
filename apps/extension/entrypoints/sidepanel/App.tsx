import { type ContextAnalysis, MIN_DRAFT_CHARS, type Site, type Transcript } from "@shoal/core";
import { GEMINI_MODELS } from "@shoal/providers";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextHealth, type ContextHealthState } from "@/components/ContextHealth";
import { Recommendation, type RecommendationState } from "@/components/Recommendation";
import { Row, type RowTone } from "@/components/Row";
import { Suggestions, type SuggestionsState } from "@/components/Suggestions";
import { VoiceDock } from "@/components/VoiceDock";
import { summarizeContext } from "@/lib/context-health";
import { loadSampleAnalysis } from "@/lib/fixtures";
import { runLiveAnalysis, runSuggestions } from "@/lib/live-analysis";
import { isShoalMessage } from "@/lib/messages";
import { requestTranscript } from "@/lib/page-transcript";
import { parsePastedConversation } from "@/lib/paste";
import { verdictText } from "@/lib/router";
import { getSettings, onSettingsChanged, type Settings } from "@/lib/settings";
import { detectSite } from "@/lib/site";
import { useRecommendation } from "@/lib/use-recommendation";
import {
  describeContext,
  describeDraft,
  describeLatestAnswer,
  describeRecommendation,
  describeUsage,
} from "@/lib/voice-tools";

/** Where the context row's data comes from. The page is the default; paste and sample are fallbacks. */
type Source = "page" | "paste" | "sample";
type PanelState = ContextHealthState | { status: "idle" };

/** Waste at or above this opens the context row by itself. */
const OPEN_AT_WASTE = 20;

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The conversation's turns as one string. The same turns always give the same signature. */
const turnsSignature = (t: Transcript) => `${t.conversationId}|${t.turns.map((turn) => turn.id).join(",")}`;

function modelSummary(state: RecommendationState): { value: string; tone: RowTone } {
  if (state.status === "ready") return { value: verdictText(state.result.recommend, state.site), tone: "neutral" };
  if (state.status === "loading") return { value: "Sizing up the prompt…", tone: "neutral" };
  if (state.status === "error") return { value: "Router offline", tone: "signal" };
  return { value: "Waiting for a prompt", tone: "neutral" };
}

function contextSummary(health: PanelState, hasKey: boolean, newChat: boolean): { value: string; tone: RowTone } {
  if (!hasKey) return { value: "Needs a Gemini key", tone: "neutral" };
  if (health.status === "loading") return { value: "Checking…", tone: "neutral" };
  if (health.status === "error") return { value: "Couldn't read this chat", tone: "signal" };
  if (health.status === "ready") {
    const s = summarizeContext(health.analysis, health.transcript);
    const turns = `${health.transcript.turns.length} ${health.transcript.turns.length === 1 ? "turn" : "turns"}`;
    if (s.flagged.length === 0) return { value: `Clean · ${turns}`, tone: "ok" };
    return { value: `${Math.round(s.wastePct)}% stale · ${s.flagged.length} of ${turns}`, tone: "signal" };
  }
  return { value: newChat ? "New chat" : "Waiting for the chat", tone: "neutral" };
}

export function App() {
  const [site, setSite] = useState<Site | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [source, setSource] = useState<Source>("page");
  const [health, setHealth] = useState<PanelState>({ status: "idle" });
  const [tips, setTips] = useState<SuggestionsState>({ status: "idle" });
  const [newChat, setNewChat] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const [pasted, setPasted] = useState("");
  const [openRow, setOpenRow] = useState<"model" | "context" | null>(null);
  const recommendation = useRecommendation();

  // Refs so message listeners always see current values.
  const settingsRef = useRef<Settings | null>(null);
  const sourceRef = useRef<Source>("page");
  const tabRef = useRef<number | undefined>(undefined);
  const analysisRef = useRef<{ conversationId: string; analysis: ContextAnalysis } | null>(null);
  /** The last finished check and the turns it was made on, so the same turns are not checked twice. */
  const checkedRef = useRef<{ signature: string; analysis: ContextAnalysis } | null>(null);
  const [checking, setChecking] = useState(false);
  const analysisRun = useRef(0);
  const tipsRun = useRef(0);

  settingsRef.current = settings;
  sourceRef.current = source;

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
    (transcript: Transcript, force = false) => {
      const s = settingsRef.current;
      if (!s?.geminiApiKey) return;
      const id = ++analysisRun.current;
      setNewChat(transcript.turns.length === 0);
      if (transcript.turns.length === 0) {
        // A new chat has nothing to prune yet; the draft can still get suggestions.
        analysisRef.current = null;
        setChecking(false);
        setHealth({ status: "idle" });
        suggest(transcript);
        return;
      }
      const signature = turnsSignature(transcript);
      const checked = checkedRef.current;
      if (!force && checked?.signature === signature) {
        // The same turns as the last check. A second run would only move the numbers by chance, so keep the result.
        setChecking(false);
        setHealth({ status: "ready", analysis: checked.analysis, transcript });
        suggest(transcript);
        return;
      }
      // Keep the last result on screen while the new one is worked out, so the list does not vanish.
      setHealth((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
      setChecking(true);
      runLiveAnalysis(async () => transcript, s)
        .then(({ analysis }) => {
          if (id !== analysisRun.current) return;
          setChecking(false);
          checkedRef.current = { signature, analysis };
          analysisRef.current = { conversationId: transcript.conversationId, analysis };
          setHealth({ status: "ready", analysis, transcript });
          setSessionCost((c) => c + analysis.usage.costUsd);
          // Waste worth acting on opens the row by itself; a clean chat stays one quiet line.
          if (analysis.wastePct >= OPEN_AT_WASTE) setOpenRow("context");
          suggest(transcript);
        })
        .catch((err: unknown) => {
          if (id !== analysisRun.current) return;
          setChecking(false);
          setHealth({ status: "error", message: message(err) });
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
      if (tab?.id === undefined || sourceRef.current !== "page" || !s?.geminiApiKey) return;
      if (!s.autoAnalyze && !force) return;
      const res = await requestTranscript(tab.id);
      if (!res.ok) {
        setHealth({ status: "error", message: res.error });
        return;
      }
      analyze(res.transcript, force);
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
      // Only the tab in view, only while reading the page, only when running automatically.
      if (sender.tab?.id !== tabRef.current || sourceRef.current !== "page" || !settingsRef.current?.autoAnalyze)
        return;
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

  const switchSource = (next: Source) => {
    analysisRun.current++;
    tipsRun.current++;
    sourceRef.current = next;
    setSource(next);
    setTips({ status: "idle" });
    setHealth({ status: "idle" });
    setNewChat(false);
    if (next === "page") void readActiveTab(true);
    if (next === "sample") {
      setOpenRow("context");
      const id = analysisRun.current;
      setHealth({ status: "loading" });
      loadSampleAnalysis()
        .then(({ analysis, transcript }) => {
          if (id === analysisRun.current) setHealth({ status: "ready", analysis, transcript });
        })
        .catch((err: unknown) => {
          if (id === analysisRun.current) setHealth({ status: "error", message: message(err) });
        });
    }
  };

  const analyzePasted = () => {
    const transcript = parsePastedConversation(pasted);
    if (!transcript) {
      setHealth({ status: "error", message: 'Start each message with a label like "User:" or "Claude:".' });
      return;
    }
    analyze(transcript);
  };

  const openSettings = () => void browser.runtime.openOptionsPage();
  const hasKey = Boolean(settings?.geminiApiKey);
  const supported = site !== null && site !== "generic";
  const watching = supported && hasKey && Boolean(settings?.autoAnalyze) && source === "page";
  const thinking =
    checking || health.status === "loading" || tips.status === "loading" || recommendation.state.status === "loading";
  const model = modelSummary(recommendation.state);
  const context =
    source === "sample"
      ? { value: "Sample conversation", tone: "neutral" as const }
      : contextSummary(health, hasKey, newChat);
  const toggle = (row: "model" | "context") => (open: boolean) => setOpenRow(open ? row : null);

  return (
    <main className="page">
      <header className="topbar">
        <span className="brand">Shoal</span>
        <span className="status" data-live={watching} data-testid="site">
          {site === null
            ? "Open a chat to start"
            : !supported
              ? "This site isn't supported"
              : watching
                ? `Watching ${site}`
                : site}
        </span>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={openSettings}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </button>
      </header>

      {!hasKey && settings && (
        <section className="section notice">
          <p>Add your Gemini API key to get tips on your draft and checks on your chat after every reply.</p>
          <div className="field-actions">
            <button type="button" className="btn" onClick={openSettings}>
              Add key
            </button>
            {source !== "sample" && (
              <button type="button" className="btn btn-quiet" onClick={() => switchSource("sample")}>
                See a sample
              </button>
            )}
          </div>
        </section>
      )}

      {hasKey && tips.status !== "idle" && (
        <section className="section" aria-labelledby="tips-title">
          <h2 id="tips-title" className="section-title">
            Before you send
          </h2>
          <Suggestions state={tips} />
        </section>
      )}

      <div className="rows">
        <Row
          title="Model"
          value={model.value}
          tone={model.tone}
          open={openRow === "model"}
          onOpenChange={toggle("model")}
        >
          <Recommendation
            state={recommendation.state}
            settings={recommendation.settings}
            onSettingsChange={recommendation.setSettings}
            usage={recommendation.usage}
            budget={recommendation.budget}
          />
        </Row>

        <Row
          title="Context"
          value={context.value}
          tone={context.tone}
          open={openRow === "context"}
          onOpenChange={toggle("context")}
        >
          {source === "sample" && (
            <p className="sample-banner">
              A made-up conversation, not your chat.{" "}
              <button type="button" className="btn btn-quiet" onClick={() => switchSource("page")}>
                Back to this chat
              </button>
            </p>
          )}

          {source === "paste" && (
            <div className="paste">
              <textarea
                className="input"
                aria-label="Conversation to check"
                placeholder={"User: first message\nClaude: the reply\nUser: what you're about to send"}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div className="field-actions">
                <button type="button" className="btn" disabled={!pasted.trim() || thinking} onClick={analyzePasted}>
                  Check pasted chat
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => switchSource("page")}>
                  Read the page instead
                </button>
              </div>
            </div>
          )}

          {(hasKey || source === "sample") && health.status !== "idle" && (
            <ContextHealth
              state={health}
              onOpenSettings={openSettings}
              onRetry={source === "page" ? () => void readActiveTab(true) : undefined}
            />
          )}

          {source === "page" && hasKey && newChat && <p className="muted">Nothing to check yet in a new chat.</p>}

          {source === "page" && hasKey && (
            <div className="field-actions">
              {(!settings?.autoAnalyze || health.status === "ready") && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={!supported || thinking}
                  onClick={() => void readActiveTab(true)}
                >
                  {settings?.autoAnalyze ? "Check again" : "Check this chat"}
                </button>
              )}
              {health.status === "error" && (
                <button type="button" className="btn btn-quiet" onClick={() => switchSource("paste")}>
                  Paste the chat instead
                </button>
              )}
            </div>
          )}
        </Row>
      </div>

      <VoiceDock
        thinking={thinking}
        onOpenSettings={openSettings}
        // What the voice model may ask Shoal. The draft and the latest answer are page text: content, not instructions.
        tools={[
          {
            name: "get_model_recommendation",
            description:
              "Returns Shoal's current advice on whether a small model is enough for the prompt the user is writing in the chat box.",
            run: () => describeRecommendation(recommendation.state, recommendation.budget, recommendation.draftText),
          },
          {
            name: "get_plan_usage",
            description: "Returns how much of the user's plan usage is used and how much is left.",
            run: () => describeUsage(recommendation.usage, recommendation.budget),
          },
          {
            name: "get_context_health",
            description:
              "Returns how much of the open conversation is stale or wasted context, and which turns Shoal flagged.",
            run: () => describeContext(health, hasKey),
          },
          {
            name: "read_latest_answer",
            description:
              "Returns the text of the most recent answer in the open chat, so you can read it aloud or summarize it.",
            run: async () => {
              const tab = await activeTab();
              return describeLatestAnswer(tab?.id === undefined ? null : await requestTranscript(tab.id));
            },
          },
          {
            name: "read_draft_prompt",
            description: "Returns the prompt the user is writing in the chat box, so you can read it back to them.",
            run: async () => {
              const tab = await activeTab();
              return describeDraft(tab?.id === undefined ? null : await requestTranscript(tab.id));
            },
          },
        ]}
      />

      {hasKey && settings && (
        <p className="footer">
          {GEMINI_MODELS[settings.analyzerModel].label}
          {sessionCost > 0 && (
            <>
              {" · "}
              <span className="num">${sessionCost.toFixed(4)}</span> this session
            </>
          )}
          {" · sent only to Google"}
        </p>
      )}
    </main>
  );
}
