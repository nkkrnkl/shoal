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

  const POLL_MS = 300; // how often the prompt box is read
  const QUIET_MS = 700; // how long the text must stay unchanged before it is routed

  let timer = null;
  let tick = 0;
  let seenModel = null; // the model name in the page's picker at the last poll
  let seenText = ""; // the text of the prompt box at the last poll
  let lastText = ""; // the text that was last sent to the router
  let routed = false; // true once a routing result or error has been shown
  let editor = null; // the prompt box that was last found
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

  function isPromptBox(el) {
    return Boolean(el) && (el.tagName === "TEXTAREA" || el.isContentEditable);
  }

  // The focused box first. Then the box found before, so the text is still read while the
  // extension popup has focus. Then the first editable box on the page.
  function findEditor() {
    if (isPromptBox(document.activeElement)) return document.activeElement;
    if (editor?.isConnected) return editor;
    return document.querySelector('[contenteditable="true"], textarea');
  }

  function editorText() {
    editor = findEditor();
    if (!editor) return "";
    return (editor.tagName === "TEXTAREA" ? editor.value : editor.innerText) || "";
  }

  function add(parent, tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }

  // Built with DOM calls, not innerHTML, so a Trusted Types policy on the page cannot block it.
  function ensureCard() {
    if (card) return card;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:16px;bottom:110px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "open" });
    try {
      // An adopted stylesheet is not subject to the page's content security policy.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CARD_CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      // Browsers that refuse adopted stylesheets in a content script get a plain <style> tag.
      add(root, "style").textContent = CARD_CSS;
    }

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
    routed = true;
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

  function showNote(title, text, meta) {
    const c = ensureCard();
    setVisible(true);
    c.pill.className = "pill";
    c.pill.textContent = title;
    c.msg.textContent = text;
    c.bar.style.display = "none";
    c.why.textContent = "";
    c.meta.textContent = meta;
  }

  function showError(text) {
    routed = true;
    showNote("Router offline", text, "Start the server, or set its address in the extension popup.");
  }

  // Shown when the page loads. It proves that the extension runs on this page and that the
  // background worker reaches the router, before anything is typed.
  async function showReady() {
    showNote("Shoal is on", "Type a prompt. This card says whether a small model is enough.", "Checking the router…");
    const res = await chrome.runtime.sendMessage({ type: "health" });
    if (routed) return;
    card.meta.textContent = res?.ok
      ? `Router connected: ${res.data.router}`
      : `Router not reachable: ${res?.error ?? "no answer from the background worker"}`;
  }

  async function check() {
    const text = editorText().trim();
    if (text === lastText) return;
    lastText = text;
    if (text.length < 6) {
      if (routed) setVisible(false);
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

  // The prompt box is read on a timer. `input` events are not enough: the editors of these
  // sites handle paste themselves, and then the browser sends no `input` event.
  // The model picker is read on the same timer, on every third tick because it scans all buttons.
  // A new model with the same text routes again, so the card follows the picker.
  setInterval(() => {
    const text = editorText().trim();
    const model = tick++ % 3 === 0 ? detectModel() : seenModel;
    if (text === seenText && model === seenModel) return;
    if (model !== seenModel) lastText = "";
    seenText = text;
    seenModel = model;
    clearTimeout(timer);
    timer = setTimeout(check, QUIET_MS);
  }, POLL_MS);

  // A change in the popup (budget, saving for later, model tier) routes the same text again,
  // so the card updates while the slider moves.
  chrome.storage.onChanged.addListener(() => {
    lastText = "";
    check();
  });

  showReady();
})();
