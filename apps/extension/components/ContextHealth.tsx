import type { ContextAnalysis, Transcript } from "@shoal/core";
import { clampPct, type FlaggedTurn, formatPct, formatTokens, summarizeContext } from "@/lib/context-health";

export type ContextHealthState =
  | { status: "no-key" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; analysis: ContextAnalysis; transcript: Transcript };

export interface ContextHealthProps {
  state: ContextHealthState;
  onOpenSettings?: () => void;
  onRetry?: () => void;
}

const LABEL_TEXT: Record<FlaggedTurn["label"], string> = {
  useless: "Useless",
  redundant: "Redundant",
  expired: "Expired",
};

/** Renders a context analysis: token meter, flagged turns and the kept count. */
export function ContextHealth({ state, onOpenSettings, onRetry }: ContextHealthProps) {
  if (state.status === "no-key") {
    return (
      <div className="notice">
        <p>Context analysis needs an API key. Keys stay on this device.</p>
        {onOpenSettings && (
          <button type="button" className="pill" onClick={onOpenSettings}>
            Open settings
          </button>
        )}
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="notice" role="status">
        <p>Reading the conversation…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <p>Analysis failed: {state.message}</p>
        {onRetry && (
          <button type="button" className="pill" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const summary = summarizeContext(state.analysis, state.transcript);
  const pct = clampPct(summary.wastePct);

  return (
    <div className="health">
      <div className="meter-block">
        <div className="readouts">
          <span>
            total <b>{formatTokens(summary.totalTokens)}</b>
          </span>
          <span>
            flagged <b>{formatTokens(summary.flaggedTokens)}</b>
          </span>
          <span>
            waste <b>{formatPct(summary.wastePct)}</b>
          </span>
        </div>
        <meter
          className="meter meter-waste"
          min={0}
          max={100}
          value={pct}
          aria-label="Share of tokens flagged as waste"
          aria-valuetext={`${formatPct(summary.wastePct)} of ${formatTokens(summary.totalTokens)} tokens flagged`}
        >
          {formatPct(summary.wastePct)}
        </meter>
      </div>

      {summary.flagged.length === 0 ? (
        <p className="muted">Nothing to trim. Every turn is pulling its weight.</p>
      ) : (
        <ol className="turns" aria-label="Flagged turns">
          {summary.flagged.map((turn) => (
            <FlaggedTurnItem key={turn.turnId} turn={turn} />
          ))}
        </ol>
      )}

      <p className="kept">
        <b>{summary.keptCount}</b> {summary.keptCount === 1 ? "turn" : "turns"} kept
      </p>
    </div>
  );
}

function FlaggedTurnItem({ turn }: { turn: FlaggedTurn }) {
  return (
    <li className="turn">
      <div className="turn-head">
        <span className={`label label-${turn.label}`}>{LABEL_TEXT[turn.label]}</span>
        <span className="turn-meta">
          {turn.turnNumber === null ? "turn ?" : `turn ${turn.turnNumber}`}
          {turn.role && ` · ${turn.role}`} · {formatTokens(turn.tokens)} tok
        </span>
      </div>
      <p className="turn-reason">{turn.reason}</p>
      {turn.label === "expired" && turn.updatedAtTurn !== null && (
        <p className="turn-note">Updated at turn {turn.updatedAtTurn}</p>
      )}
      {turn.takeaway && (
        <p className="turn-takeaway">
          <span className="tag">Takeaway</span> {turn.takeaway}
        </p>
      )}
    </li>
  );
}
