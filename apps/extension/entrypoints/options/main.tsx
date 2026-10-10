import "@/assets/theme.css";
import { AuthError } from "@shoal/core";
import { checkGeminiKey, GEMINI_MODELS, type GeminiModel } from "@shoal/providers";
import { type FormEvent, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterSettings } from "@/components/RouterSettings";
import { getSettings, maskKey, type Settings, saveSettings } from "@/lib/settings";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err: unknown) => setStatus({ kind: "error", text: `Could not load settings: ${String(err)}` }));
  }, []);

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    const key = keyInput.trim();
    if (!key) return;
    setStatus({ kind: "busy" });
    try {
      await checkGeminiKey(key);
      setSettings(await saveSettings({ geminiApiKey: key }));
      setKeyInput("");
      setStatus({ kind: "ok", text: "Key works and is saved on this device." });
    } catch (err) {
      const text =
        err instanceof AuthError
          ? "Google rejected this key. Check that you copied all of it."
          : `Could not check the key: ${err instanceof Error ? err.message : String(err)}`;
      setStatus({ kind: "error", text });
    }
  };

  const removeKey = async () => {
    setSettings(await saveSettings({ geminiApiKey: "" }));
    setStatus({ kind: "ok", text: "Key removed." });
  };

  const chooseModel = async (analyzerModel: GeminiModel) => {
    setSettings(await saveSettings({ analyzerModel }));
  };

  return (
    <main className="page settings">
      <h1 className="wordmark">Shoal settings</h1>

      <section className="section" aria-labelledby="key-title">
        <h2 id="key-title">Gemini API key</h2>
        <p className="muted">
          Shoal uses your own key to analyze conversations. Get one free at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            Google AI Studio
          </a>
          . The key is stored only in this browser and is sent only to Google.
        </p>

        {settings?.geminiApiKey ? (
          <div className="notice">
            <p>
              Saved key <span className="tag">{maskKey(settings.geminiApiKey)}</span>
            </p>
            <button type="button" className="pill" onClick={() => void removeKey()}>
              Remove key
            </button>
          </div>
        ) : null}

        <form className="field-row" onSubmit={(e) => void saveKey(e)}>
          <label className="field">
            <span className="tag">{settings?.geminiApiKey ? "Replace key" : "Key"}</span>
            <input
              className="input"
              type={reveal ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="AIza…"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
            />
          </label>
          <div className="field-actions">
            <button type="button" className="pill" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
              {reveal ? "Hide" : "Show"}
            </button>
            <button type="submit" className="pill" disabled={!keyInput.trim() || status.kind === "busy"}>
              {status.kind === "busy" ? "Checking…" : "Test & save"}
            </button>
          </div>
        </form>

        {status.kind === "ok" && (
          <p className="muted" role="status">
            {status.text}
          </p>
        )}
        {status.kind === "error" && (
          <p className="notice-error" role="alert">
            {status.text}
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="model-title">
        <h2 id="model-title">Analyzer model</h2>
        <fieldset className="choices">
          <legend className="muted">Used for context analysis. Prices are per million tokens.</legend>
          {(Object.keys(GEMINI_MODELS) as GeminiModel[]).map((id) => {
            const m = GEMINI_MODELS[id];
            return (
              <label key={id} className="choice">
                <input
                  type="radio"
                  name="model"
                  value={id}
                  checked={settings?.analyzerModel === id}
                  onChange={() => void chooseModel(id)}
                />
                <span>
                  {m.label}
                  <span className="muted">
                    {" "}
                    · ${m.inputPerMTok} in / ${m.outputPerMTok} out
                    {id === "gemini-3.8-flash" ? " · most accurate" : " · cheapest"}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </section>

      <section className="section" aria-labelledby="auto-title">
        <h2 id="auto-title">Run automatically</h2>
        <label className="choice">
          <input
            type="checkbox"
            checked={settings?.autoAnalyze ?? true}
            onChange={(e) => void saveSettings({ autoAnalyze: e.target.checked }).then(setSettings)}
          />
          <span>
            Analyze the chat after every reply and suggest context while you type
            <span className="muted"> · usually well under a cent per turn</span>
          </span>
        </label>
      </section>

      <RouterSettings />

      <section className="section" aria-labelledby="privacy-title">
        <h2 id="privacy-title">What Shoal reads</h2>
        <p className="muted">
          While the side panel is open, Shoal reads the open conversation on claude.ai, chatgpt.com or
          gemini.google.com, including the message you are typing, and sends it to Google with your key. While a voice
          session is open, your voice goes to Google with the same key. To pick a model, the message you are typing also
          goes to the router you run on this computer, which scores it with Jev. On claude.ai, Shoal reads your plan
          usage from the site itself. Nothing is stored outside this browser.
        </p>
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
