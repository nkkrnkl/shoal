import "@/assets/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// API key settings land in the provider clients issue.
function Options() {
  return (
    <main className="page">
      <h1 className="wordmark">Shoal settings</h1>
      <p className="muted">API keys and site permissions will be configured here.</p>
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
