import "@/assets/voice.css";
import type { FormEvent } from "react";
import type { VoiceLine, VoiceProblem, VoiceStatus } from "@/lib/use-voice";

export interface VoiceProps {
  status: VoiceStatus;
  problem: VoiceProblem | null;
  lines: VoiceLine[];
  onStart: () => void;
  onStop: () => void;
  onSend: (text: string) => void;
  onOpenSettings: () => void;
}

const STATUS_TEXT: Record<VoiceStatus, string> = {
  off: "off",
  connecting: "connecting",
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
};

const SPEAKER: Record<VoiceLine["who"], string> = { user: "You", shoal: "Shoal" };

/** The voice controls: start and stop, what was said, and a text box for when talking is not possible. */
export function Voice({ status, problem, lines, onStart, onStop, onSend, onOpenSettings }: VoiceProps) {
  const on = status !== "off";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    onSend(String(new FormData(form).get("question") ?? ""));
    form.reset();
  };

  return (
    <section className="voice" aria-label="Voice">
      <div className="voice-row">
        <button type="button" className="pill" aria-pressed={on} onClick={on ? onStop : onStart}>
          {on ? "Stop voice" : "Talk to Shoal"}
        </button>
        {on && (
          <span className="tag" role="status">
            {STATUS_TEXT[status]}
          </span>
        )}
      </div>

      {problem && <VoiceProblemNotice problem={problem} onOpenSettings={onOpenSettings} />}

      {lines.length > 0 && (
        <ol className="voice-lines" aria-label="Conversation">
          {lines.map((line, i) => (
            // Lines only grow at the end, so the position is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: see the comment above
            <li key={i} className={`voice-line voice-${line.who}`}>
              <span className="tag">{SPEAKER[line.who]}</span> {line.text}
            </li>
          ))}
        </ol>
      )}

      {on && (
        <form className="voice-ask" onSubmit={submit}>
          <input type="text" name="question" aria-label="Type a question" placeholder="Or type a question" />
          <button type="submit" className="pill">
            Ask
          </button>
        </form>
      )}
    </section>
  );
}

function VoiceProblemNotice({ problem, onOpenSettings }: { problem: VoiceProblem; onOpenSettings: () => void }) {
  if (problem.kind === "failed") {
    return (
      <div className="notice notice-error" role="alert">
        <p>Voice stopped: {problem.message}</p>
      </div>
    );
  }
  return (
    <div className="notice" role="alert">
      <p>
        {problem.kind === "no-key"
          ? "Voice needs a Gemini API key. The key stays on this device."
          : "The microphone is blocked. Allow it in the settings, then start voice again. You can still type a question."}
      </p>
      <button type="button" className="pill" onClick={onOpenSettings}>
        Open settings
      </button>
    </div>
  );
}
