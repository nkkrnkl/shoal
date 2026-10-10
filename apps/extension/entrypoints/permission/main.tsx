import "@/assets/theme.css";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

type Status = "ask" | "busy" | "granted" | "denied";

/** One-time page that asks for the microphone, which Chrome cannot do from the side panel. */
function Permission() {
  const [status, setStatus] = useState<Status>("ask");

  const allow = async () => {
    setStatus("busy");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setStatus("granted");
      // Extension pages opened by the extension may close themselves.
      setTimeout(() => window.close(), 1200);
    } catch {
      setStatus("denied");
    }
  };

  return (
    <main className="page settings">
      <h1 className="wordmark">Talk to Shoal</h1>
      <p className="muted">
        Shoal uses the microphone only while a voice session is open in the side panel. During a session your voice is
        sent to Google with your Gemini key, so Shoal can answer out loud. Nothing is recorded or stored.
      </p>
      {status === "granted" ? (
        <p role="status">Microphone allowed. Go back to the side panel and press the fish again.</p>
      ) : status === "denied" ? (
        <p className="notice-error" role="alert">
          Chrome blocked the microphone. Allow it from the icon at the right of the address bar, then try again.
        </p>
      ) : (
        <div className="field-actions">
          <button type="button" className="btn" disabled={status === "busy"} onClick={() => void allow()}>
            Allow microphone
          </button>
        </div>
      )}
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <Permission />
  </StrictMode>,
);
