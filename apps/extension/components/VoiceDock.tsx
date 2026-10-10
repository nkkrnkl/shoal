import "@/assets/voice.css";
import { type FormEvent, useState } from "react";
import { ShoalOrb } from "@/components/ShoalOrb";
import type { LiveTool } from "@/lib/live";
import { openMicPermissionPage } from "@/lib/mic";
import { useVoice, type VoiceLine, type VoiceStatus } from "@/lib/use-voice";

export interface VoiceDockProps {
  /** The panel is doing background work. Shown by the resting orb. */
  thinking?: boolean;
  /** What the voice model may ask Shoal during a conversation. */
  tools?: LiveTool[];
  onOpenSettings?: () => void;
}

const CAPTION: Record<Exclude<VoiceStatus, "off">, string> = {
  connecting: "Connecting…",
  listening: "Listening. Ask which model fits, how your usage looks, or whether this chat is stale.",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

const SPEAKER: Record<VoiceLine["who"], string> = { user: "You", shoal: "Shoal" };

/**
 * The one prominent control in the panel. At rest it is a small fish orb. Pressed, it opens a voice
 * conversation with Gemini Live: the shoal moves with your voice while it listens and with Shoal's
 * voice while it answers. A text box takes typed questions when talking is not possible.
 */
export function VoiceDock({ thinking = false, tools = [], onOpenSettings }: VoiceDockProps) {
  const voice = useVoice(tools);
  const [typing, setTyping] = useState(false);

  if (voice.status !== "off") {
    const orb = voice.status === "connecting" ? "thinking" : voice.status;
    const ask = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      voice.sendText(String(new FormData(form).get("question") ?? ""));
      form.reset();
    };
    return (
      <section className="voice" aria-label="Voice">
        <div className="voice-stage">
          <ShoalOrb state={orb} level={orb === "listening" || orb === "speaking" ? voice.level : undefined} />
        </div>
        <p className="voice-caption" role="status" data-state={voice.status}>
          {CAPTION[voice.status]}
        </p>
        {voice.lines.length > 0 && (
          <ol className="voice-lines" aria-label="Conversation">
            {voice.lines.map((line, i) => (
              // Lines only grow at the end, so the position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see the comment above
              <li key={i} className="voice-line" data-who={line.who}>
                <span className="voice-who">{SPEAKER[line.who]}</span> {line.text}
              </li>
            ))}
          </ol>
        )}
        {typing && (
          <form className="voice-ask" onSubmit={ask}>
            <input
              className="input"
              type="text"
              name="question"
              aria-label="Type a question"
              placeholder="Type a question"
              // biome-ignore lint/a11y/noAutofocus: the field appears because the user asked to type
              autoFocus
            />
            <button type="submit" className="btn">
              Ask
            </button>
          </form>
        )}
        <div className="voice-bar">
          <button type="button" className="btn btn-quiet" aria-pressed={typing} onClick={() => setTyping((t) => !t)}>
            {typing ? "Hide keyboard" : "Type instead"}
          </button>
          <button
            type="button"
            className="btn btn-end"
            onClick={() => {
              setTyping(false);
              voice.stop();
            }}
          >
            End
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="voice" aria-label="Voice">
      <button type="button" className="voice-btn" aria-label="Talk to Shoal" onClick={voice.start}>
        <ShoalOrb state={thinking ? "thinking" : "idle"} count={80} fishScale={0.6} />
      </button>
      <span className="voice-label" aria-hidden="true">
        Talk to Shoal
      </span>
      {voice.problem?.kind === "mic-blocked" && (
        <div className="notice" role="alert">
          <p className="muted">Chrome needs your OK once before Shoal can use the microphone.</p>
          <button type="button" className="btn" onClick={openMicPermissionPage}>
            Allow microphone
          </button>
        </div>
      )}
      {voice.problem?.kind === "no-key" && (
        <div className="notice" role="alert">
          <p className="muted">Voice uses your Gemini API key. Add it in the settings.</p>
          {onOpenSettings && (
            <button type="button" className="btn" onClick={onOpenSettings}>
              Add key
            </button>
          )}
        </div>
      )}
      {voice.problem?.kind === "failed" && (
        <p className="notice-error" role="alert">
          Voice stopped: {voice.problem.message}
        </p>
      )}
    </section>
  );
}
