// Calls the local router from the extension's own origin, which avoids page CORS and
// private-network restrictions on claude.ai, gemini.google.com and chatgpt.com.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "route") return false;
  chrome.storage.local
    .get({ server: "http://localhost:8000" })
    .then(({ server }) =>
      fetch(`${server}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg.payload),
      }),
    )
    .then(async (r) => {
      if (!r.ok) throw new Error(`router returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the channel open for the async response
});
