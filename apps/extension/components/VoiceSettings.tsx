import "@/assets/voice.css";
import { type FormEvent, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { GEMINI_KEY } from "@/lib/use-voice";

type MicState = "unknown" | "allowed" | "refused";

/** Settings for voice: the user's Gemini API key, and the one-time microphone permission. */
export function VoiceSettings() {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [mic, setMic] = useState<MicState>("unknown");

  useEffect(() => {
    browser.storage.local
      .get({ [GEMINI_KEY]: "" })
      .then((stored) => setKey(String(stored[GEMINI_KEY])))
      .catch(() => {
        // Keep the empty field.
      });
  }, []);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void browser.storage.local.set({ [GEMINI_KEY]: key.trim() }).then(() => setSaved(true));
  };

  // Chrome shows the microphone question on a full page like this one, but not in the side panel.
  // Once it is allowed here, the side panel may use the microphone too.
  const allowMic = () => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        for (const track of stream.getTracks()) track.stop();
        setMic("allowed");
      })
      .catch(() => setMic("refused"));
  };

  return (
    <section className="section" aria-labelledby="voice-settings-title">
      <div className="section-head">
        <h2 id="voice-settings-title">Voice</h2>
      </div>
      <form className="notice" onSubmit={save}>
        <label className="voice-field">
          <span>Gemini API key</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <p className="muted">
          Voice uses Google's Gemini live model. The key stays on this device and is sent to Google only.
        </p>
        <button type="submit" className="pill">
          Save key
        </button>
        {saved && (
          <p className="muted" role="status">
            Saved.
          </p>
        )}
      </form>
      <div className="notice">
        <p>Shoal needs your permission once to use the microphone.</p>
        <button type="button" className="pill" onClick={allowMic}>
          Allow microphone
        </button>
        {mic === "allowed" && (
          <p className="muted" role="status">
            Microphone allowed. You can close this page.
          </p>
        )}
        {mic === "refused" && (
          <p className="muted" role="alert">
            The microphone was refused. Check the microphone icon in the address bar.
          </p>
        )}
      </div>
    </section>
  );
}
