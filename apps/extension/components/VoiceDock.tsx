import { useEffect, useRef, useState } from "react";
import { ShoalOrb } from "@/components/ShoalOrb";
import { MicPermissionError, type MicSession, openMicPermissionPage, startMic } from "@/lib/mic";

type VoiceState =
  | { status: "off" }
  | { status: "starting" }
  | { status: "listening" }
  | { status: "needs-permission" }
  | { status: "error"; message: string };

/**
 * The one prominent control in the panel. At rest it is a small fish orb; pressed, it opens the microphone and the
 * shoal grows and moves with your voice. Voice answers (Gemini Live, #37) are not connected yet.
 */
export function VoiceDock({ thinking = false }: { thinking?: boolean }) {
  const [voice, setVoice] = useState<VoiceState>({ status: "off" });
  const [level, setLevel] = useState(0);
  const session = useRef<MicSession | null>(null);

  useEffect(() => {
    if (voice.status !== "listening") return;
    let raf = 0;
    const tick = () => {
      setLevel(session.current?.level() ?? 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [voice.status]);

  // Release the microphone if the panel closes mid-session.
  useEffect(() => () => session.current?.stop(), []);

  const start = async () => {
    setVoice({ status: "starting" });
    try {
      session.current = await startMic();
      setVoice({ status: "listening" });
    } catch (err) {
      setVoice(
        err instanceof MicPermissionError
          ? { status: "needs-permission" }
          : { status: "error", message: err instanceof Error ? err.message : String(err) },
      );
    }
  };

  const stop = () => {
    session.current?.stop();
    session.current = null;
    setLevel(0);
    setVoice({ status: "off" });
  };

  if (voice.status === "listening") {
    return (
      <section className="voice" aria-label="Voice">
        <div className="voice-stage">
          <ShoalOrb state="listening" level={level} />
        </div>
        <p className="voice-caption" role="status">
          Listening. Shoal can hear you; spoken answers arrive with the Gemini Live update.
        </p>
        <button type="button" className="btn" onClick={stop}>
          Stop
        </button>
      </section>
    );
  }

  return (
    <section className="voice" aria-label="Voice">
      <button
        type="button"
        className="voice-btn"
        aria-label="Talk to Shoal"
        disabled={voice.status === "starting"}
        onClick={() => void start()}
      >
        <ShoalOrb state={thinking ? "thinking" : "idle"} count={60} fishScale={0.55} />
      </button>
      <span className="voice-label" aria-hidden="true">
        {voice.status === "starting" ? "Opening microphone…" : "Talk to Shoal"}
      </span>
      {voice.status === "needs-permission" && (
        <div className="notice" role="alert">
          <p className="muted">Chrome needs your OK once before Shoal can use the microphone.</p>
          <button type="button" className="btn" onClick={openMicPermissionPage}>
            Allow microphone
          </button>
        </div>
      )}
      {voice.status === "error" && (
        <p className="notice-error" role="alert">
          Could not open the microphone: {voice.message}
        </p>
      )}
    </section>
  );
}
