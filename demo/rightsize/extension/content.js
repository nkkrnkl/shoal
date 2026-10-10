(() => {
  function appName() {
    if (location.hostname.endsWith("claude.ai")) return "claude";
    if (location.hostname.endsWith("gemini.google.com")) return "gemini";
    return "chatgpt";
  }
  const APP = appName();
  // Model names to look for in the page's model picker. Best-effort; the popup has a manual override.
  const PICKER_NAMES = {
    claude: ["Fable", "Opus", "Sonnet", "Haiku"],
    gemini: ["Deep Think", "Thinking", "Flash-Lite", "Flash", "Pro", "Fast"],
    chatgpt: ["Thinking", "Instant", "mini", "Pro", "Auto"],
  }[APP];

  const CARD_CSS = `
    :host { all: initial; }
    .card { --bg:#ffffff; --fg:#14171c; --muted:#5b6370; --line:#d9dde3; --small:#1f7a4d; --big:#9a5b00;
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--fg); background: var(--bg);
      border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; width: 300px;
      box-shadow: 0 6px 24px rgba(0,0,0,.12); display: grid; gap: 8px; }
    @media (prefers-color-scheme: dark) {
      .card { --bg:#1b1f26; --fg:#e8ebf0; --muted:#a2aab6; --line:#2e3440; --small:#5cc98f; --big:#e3a64a; }
    }
    .top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .pill { font-weight: 600; font-size: 12px; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
    .pill.small { color: var(--small); } .pill.frontier { color: var(--big); }
    .msg { color: var(--fg); }
    .why { color: var(--muted); font-size: 12px; }
    .meta { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
    .bar { position: relative; height: 6px; border-radius: 3px; background: var(--line); }
    .fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px; background: var(--fg); opacity: .55; }
    .tick { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--big); }
    button { all: unset; cursor: pointer; color: var(--muted); font-size: 15px; padding: 0 2px; }
    button:focus-visible { outline: 2px solid var(--big); border-radius: 3px; }`;

  let timer = null;
  let lastText = "";
  let editor = null; // the prompt box that last received input
  let card = null;

  function detectModel() {
    const els = document.querySelectorAll('button, [role="button"], [aria-haspopup]');
    for (const el of els) {
      const t = (el.innerText || "").trim();
      if (!t || t.length > 40 || /upgrade|try|get /i.test(t)) continue;
      if (PICKER_NAMES.some((n) => t.includes(n))) return t;
    }
    return null;
  }

  // Reads the remembered prompt box, so the text is still found while the extension popup has focus.
  function editorText() {
    const el = editor?.isConnected ? editor : document.activeElement;
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
    if (el.isContentEditable) return el.innerText || "";
    return "";
  }

  function add(parent, tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }

  // Built with DOM calls and an adopted stylesheet, not innerHTML or a <style> tag, so a strict
  // content security policy or Trusted Types policy on the page cannot block it.
  function ensureCard() {
    if (card) return card;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:110px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CARD_CSS);
    root.adoptedStyleSheets = [sheet];

    const box = add(root, "div", "card");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    const top = add(box, "div", "top");
    const pill = add(top, "span", "pill");
    const close = add(top, "button");
    close.type = "button";
    close.setAttribute("aria-label", "Hide");
    close.textContent = "×";
    close.addEventListener("click", () => setVisible(false));
    const msg = add(box, "div", "msg");
    const bar = add(box, "div", "bar");
    const fill = add(bar, "div", "fill");
    const tick = add(bar, "div", "tick");
    const why = add(box, "div", "why");
    const meta = add(box, "div", "meta");
    document.documentElement.appendChild(host);
    card = { host, pill, msg, bar, fill, tick, why, meta };
    return card;
  }

  // The `hidden` attribute does not work here: `:host { all: initial }` overrides it.
  function setVisible(visible) {
    if (card) card.host.style.display = visible ? "" : "none";
  }

  function show(data) {
    const c = ensureCard();
    setVisible(true);
    const p = Math.round(data.p_strong * 100);
    const tau = Math.round(data.threshold * 100);
    c.pill.className = `pill ${data.recommend}`;
    c.pill.textContent = data.recommend === "small" ? "Small model is enough" : "Use a frontier model";
    c.msg.textContent = data.message;
    c.bar.style.display = "";
    c.fill.style.width = `${p}%`;
    c.tick.style.left = `calc(${tau}% - 1px)`;
    c.why.textContent = data.why ?? "";
    c.meta.textContent = `P(big model clearly better) ${p}% · threshold ${tau}% · ${data.router} · ${data.latency_ms} ms`;
  }

  function showError(text) {
    const c = ensureCard();
    setVisible(true);
    c.pill.className = "pill";
    c.pill.textContent = "Router offline";
    c.msg.textContent = text;
    c.bar.style.display = "none";
    c.why.textContent = "";
    c.meta.textContent = "Start the server, or set its address in the extension popup.";
  }

  async function check() {
    const text = editorText().trim();
    if (text === lastText) return;
    lastText = text;
    if (text.length < 6) {
      setVisible(false);
      return;
    }
    const s = await chrome.storage.local.get({ budget: 100, saveForLater: false, tier: "auto" });
    const payload = {
      text,
      app: APP,
      current_model: detectModel(),
      current_tier: s.tier === "auto" ? null : s.tier,
      budget_left: s.budget / 100,
      save_for_later: s.saveForLater,
    };
    const res = await chrome.runtime.sendMessage({ type: "route", payload });
    if (text !== lastText) return; // user kept typing; a newer request will render
    if (res?.ok) show(res.data);
    else showError(res?.error ?? "No answer from the extension's background worker.");
  }

  document.addEventListener(
    "input",
    (e) => {
      editor = e.composedPath()[0] ?? e.target;
      clearTimeout(timer);
      timer = setTimeout(check, 700);
    },
    true,
  );

  // A change in the popup (budget, saving for later, model tier) routes the same text again,
  // so the card updates while the slider moves.
  chrome.storage.onChanged.addListener(() => {
    lastText = "";
    check();
  });
})();
