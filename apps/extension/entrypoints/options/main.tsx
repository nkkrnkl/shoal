import "@/assets/theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VoiceSettings } from "@/components/VoiceSettings";

// The other provider keys land in the provider clients issue.
function Options() {
  return (
    <main className="page">
      <h1 className="wordmark">Shoal settings</h1>
      <VoiceSettings />
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
