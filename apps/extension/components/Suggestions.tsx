import type { ContextSuggestion, SuggestionKind, Transcript } from "@shoal/core";
import { turnNumberOf } from "@/lib/context-health";

export type SuggestionsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; suggestions: ContextSuggestion[]; transcript: Transcript };

const KIND_TEXT: Record<SuggestionKind, string> = {
  add_context: "Add context",
  clarify: "Clarify",
  stale_reference: "Outdated",
  start_fresh: "Start fresh",
};

/** Tips for the message being typed. Renders nothing until there is a draft to look at. */
export function Suggestions({ state }: { state: SuggestionsState }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="muted" role="status">
        Reading your draft…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className="notice-error" role="alert">
        Suggestions failed: {state.message}
      </p>
    );
  }
  if (state.suggestions.length === 0) {
    return <p className="muted">Your draft has the context it needs.</p>;
  }
  return (
    <ul className="turns" aria-label="Suggestions for your draft">
      {state.suggestions.map((s) => {
        const turn = turnNumberOf(state.transcript, s.turnId);
        return (
          <li key={`${s.kind}-${s.text}`} className="turn">
            <div className="turn-head">
              <span className={`label label-${s.kind === "stale_reference" ? "expired" : "redundant"}`}>
                {KIND_TEXT[s.kind]}
              </span>
              {turn !== null && <span className="turn-meta">turn {turn}</span>}
            </div>
            <p className="turn-note">{s.text}</p>
          </li>
        );
      })}
    </ul>
  );
}
