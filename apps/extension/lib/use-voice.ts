import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { MicCapture, Speaker } from "@/lib/audio";
import { type LiveEvent, LiveSession, type LiveTool } from "@/lib/live";

/** Where the user's Gemini API key is kept in `storage.local`. It never goes to `storage.sync` or to Shoal's backend. */
export const GEMINI_KEY = "gemini.apiKey";

export type VoiceStatus = "off" | "connecting" | "listening" | "thinking" | "speaking";

export type VoiceProblem =
  | { kind: "no-key" }
  /** The microphone was refused. The session stays open, so typed questions still get a spoken answer. */
  | { kind: "mic-blocked" }
  | { kind: "failed"; message: string };

export interface VoiceLine {
  who: "user" | "shoal";
  text: string;
}

const KEPT_LINES = 6;
const TICK_MS = 80;

const INSTRUCTION = [
  "You are Shoal, a voice assistant in a browser side panel next to a chat app.",
  "You help the user pick the right model for the prompt they are writing, and keep an eye on their plan usage.",
  "Speak in one or two short, plain sentences.",
  "When the user asks which model to use, whether a small model is enough, or anything about their prompt, call get_model_recommendation and base your answer on its result.",
  "When the user asks about their plan usage or budget, call get_plan_usage.",
  "If a tool says there is no prompt yet, ask the user to type one in the chat box.",
  "Never invent numbers. Use only the numbers the tools return.",
].join(" ");

/**
 * A voice conversation with Gemini's live model. `tools` are read at call time, so they always
 * answer with the panel's current state.
 */
export function useVoice(tools: LiveTool[]): {
  status: VoiceStatus;
  /** Loudness of the microphone while listening, or of the speech while speaking, 0 to 1. */
  level: number;
  lines: VoiceLine[];
  problem: VoiceProblem | null;
  start: () => void;
  stop: () => void;
  sendText: (text: string) => void;
} {
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [level, setLevel] = useState(0);
  const [lines, setLines] = useState<VoiceLine[]>([]);
  const [problem, setProblem] = useState<VoiceProblem | null>(null);

  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const session = useRef<LiveSession | null>(null);
  const mic = useRef<MicCapture | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const linesRef = useRef<VoiceLine[]>([]);
  /** Who is in the middle of a line, so fragments of one utterance join into one line. */
  const speakingLine = useRef<VoiceLine["who"] | null>(null);
  const turnDone = useRef(true);

  const addText = useCallback((who: VoiceLine["who"], text: string) => {
    const previous = linesRef.current;
    const last = previous.at(-1);
    const next =
      last && last.who === who && speakingLine.current === who
        ? [...previous.slice(0, -1), { who, text: last.text + text }]
        : [...previous, { who, text }].slice(-KEPT_LINES);
    speakingLine.current = who;
    linesRef.current = next;
    setLines(next);
  }, []);

  const shutDown = useCallback(() => {
    session.current?.close();
    session.current = null;
    mic.current?.stop();
    mic.current = null;
    speaker.current?.close();
    speaker.current = null;
    setStatus("off");
    setLevel(0);
  }, []);

  const onEvent = useCallback(
    (event: LiveEvent) => {
      switch (event.kind) {
        case "ready":
          setStatus("listening");
          break;
        case "toolCall":
          setStatus("thinking");
          break;
        case "audio":
          turnDone.current = false;
          speaker.current?.play(event.pcm);
          setStatus("speaking");
          break;
        case "said":
          addText(event.who, event.text);
          break;
        case "interrupted":
          speaker.current?.flush();
          break;
        case "turnComplete":
          turnDone.current = true;
          speakingLine.current = null;
          break;
      }
    },
    [addText],
  );

  const start = useCallback(() => {
    if (session.current) return;
    setProblem(null);
    setStatus("connecting");
    void (async () => {
      const stored = await browser.storage.local.get({ [GEMINI_KEY]: "" });
      const apiKey = String(stored[GEMINI_KEY]).trim();
      if (!apiKey) {
        setProblem({ kind: "no-key" });
        setStatus("off");
        return;
      }
      speaker.current = new Speaker();
      const live = new LiveSession({
        apiKey,
        instruction: INSTRUCTION,
        // Proxies: the model sees the tools as they are now, and each call runs the latest version.
        tools: toolsRef.current.map((tool) => ({
          ...tool,
          run: () => toolsRef.current.find((t) => t.name === tool.name)?.run() ?? null,
        })),
        onEvent,
        onClose: (reason) => {
          if (session.current !== live) return;
          shutDown();
          if (reason) setProblem({ kind: "failed", message: reason });
        },
      });
      session.current = live;
      live.open();
      try {
        const capture = await MicCapture.start((pcm) => live.sendAudio(pcm));
        if (session.current === live) mic.current = capture;
        else capture.stop();
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        if (name === "NotAllowedError" || name === "NotFoundError") setProblem({ kind: "mic-blocked" });
        else setProblem({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [onEvent, shutDown]);

  const stop = useCallback(() => {
    shutDown();
    setProblem(null);
  }, [shutDown]);

  const sendText = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question || !session.current) return;
      speakingLine.current = null;
      addText("user", question);
      speakingLine.current = null;
      setStatus("thinking");
      session.current.sendText(question);
    },
    [addText],
  );

  // While a session is open: move the level for the orb, and return to "listening" when the speech has played out.
  useEffect(() => {
    if (status === "off") return;
    const timer = setInterval(() => {
      const out = speaker.current;
      if (out?.speaking) {
        setLevel(out.level());
        return;
      }
      setLevel(mic.current?.level() ?? 0);
      if (turnDone.current) setStatus((current) => (current === "speaking" ? "listening" : current));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [status]);

  // Close the microphone and the socket when the panel goes away.
  useEffect(() => shutDown, [shutDown]);

  return { status, level, lines, problem, start, stop, sendText };
}
