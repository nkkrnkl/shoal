import { type FormEvent, useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { DEFAULT_ROUTER_URL } from "@/lib/router";
import { ROUTER_URL_KEY } from "@/lib/use-recommendation";

/** Settings for the model router: the address of the Right-size service that scores the draft. */
export function RouterSettings() {
  const [url, setUrl] = useState(DEFAULT_ROUTER_URL);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    browser.storage.local
      .get({ [ROUTER_URL_KEY]: DEFAULT_ROUTER_URL })
      .then((stored) => setUrl(String(stored[ROUTER_URL_KEY])))
      .catch(() => {
        // Keep the default.
      });
  }, []);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = url.trim().replace(/\/+$/, "") || DEFAULT_ROUTER_URL;
    setUrl(next);
    void browser.storage.local.set({ [ROUTER_URL_KEY]: next }).then(() => setSaved(true));
  };

  return (
    <section className="section" aria-labelledby="router-title">
      <h2 id="router-title">Model router</h2>
      <p className="muted">
        The address of the Right-size router that says whether a small model is enough. The message you are typing is
        sent to this address. The default is the router on this computer.
      </p>
      <form className="field-row" onSubmit={save}>
        <label className="field">
          <span className="tag">Router address</span>
          <input
            className="input"
            type="url"
            spellCheck={false}
            placeholder={DEFAULT_ROUTER_URL}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <div className="field-actions">
          <button type="submit" className="pill">
            Save address
          </button>
        </div>
      </form>
      {saved && (
        <p className="muted" role="status">
          Saved. The side panel uses it from now on.
        </p>
      )}
    </section>
  );
}
