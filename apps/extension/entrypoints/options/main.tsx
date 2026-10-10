import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// API key settings land in the provider clients issue.
function Options() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Shoal settings</h1>
      <p>API keys and site permissions will be configured here.</p>
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
