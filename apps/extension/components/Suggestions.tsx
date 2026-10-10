import type { ContextSuggestion, SuggestionKind, Transcript } from "@shoal/core";
import { turnNumberOf } from "@/lib/context-health";

export type SuggestionsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; suggestions: ContextSuggestion[]; transcript: Transcript };

/** Most tips add context, so only the other kinds get a label. */
const KIND_TEXT: Record<SuggestionKind, string | null> = {
  add_context: null,
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
        {state.message}
      </p>
    );
  }
  if (state.suggestions.length === 0) {
    return <p className="muted">Your draft has what the answer needs.</p>;
  }
  return (
    <ul className="tips" aria-label="Suggestions for your draft">
      {state.suggestions.map((s) => {
        const turn = turnNumberOf(state.transcript, s.turnId);
        return (
          <li key={`${s.kind}-${s.text}`} className="tip" data-kind={s.kind}>
            <span>{s.text}</span>
            {(KIND_TEXT[s.kind] || turn !== null) && (
              <span className="tip-kind">
                {[KIND_TEXT[s.kind], turn !== null ? `turn ${turn}` : null].filter(Boolean).join(" · ")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
