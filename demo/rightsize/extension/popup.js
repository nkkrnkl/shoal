const $ = (id) => document.getElementById(id);

chrome.storage.local
  .get({ budget: 100, saveForLater: false, tier: "auto", server: "http://localhost:8000" })
  .then((s) => {
    $("budget").value = s.budget;
    $("budget-out").textContent = `${s.budget}%`;
    $("save").checked = s.saveForLater;
    $("tier").value = s.tier;
    $("server").value = s.server;
  });

$("budget").addEventListener("input", (e) => {
  $("budget-out").textContent = `${e.target.value}%`;
  chrome.storage.local.set({ budget: Number(e.target.value) });
});
$("save").addEventListener("change", (e) => chrome.storage.local.set({ saveForLater: e.target.checked }));
$("tier").addEventListener("change", (e) => chrome.storage.local.set({ tier: e.target.value }));
$("server").addEventListener("change", (e) => chrome.storage.local.set({ server: e.target.value.replace(/\/$/, "") }));
