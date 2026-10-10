import "@/assets/router.css";
import type { RouteResult, RouterSettings } from "@/lib/router";

export type RecommendationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: RouteResult; refreshing: boolean };

export interface RecommendationProps {
  state: RecommendationState;
  settings: RouterSettings;
  onSettingsChange: (next: RouterSettings) => void;
}

/** The verdict in words, also used as the one-line summary of the model row. */
export const VERDICT: Record<RouteResult["recommend"], string> = {
  small: "Small model is enough",
  frontier: "Use a frontier model",
};

function pct(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

/** Renders the router's advice for the draft prompt, and the budget controls that move its threshold. */
export function Recommendation({ state, settings, onSettingsChange }: RecommendationProps) {
  return (
    <div className="route">
      <RecommendationBody state={state} />
      <div className="route-budget">
        <label className="route-slider">
          <span className="readouts">
            <span>
              plan usage left <b>{settings.budget}%</b>
            </span>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={settings.budget}
            onChange={(e) => onSettingsChange({ ...settings, budget: Number(e.target.value) })}
          />
        </label>
        <label className="route-check">
          <input
            type="checkbox"
            checked={settings.savingForLater}
            onChange={(e) => onSettingsChange({ ...settings, savingForLater: e.target.checked })}
          />
          <span>Saving usage for something big later</span>
        </label>
      </div>
    </div>
  );
}

function RecommendationBody({ state }: { state: RecommendationState }) {
  if (state.status === "idle") {
    return (
      <div className="notice">
        <p>Type a prompt on the chat page. Shoal says whether a small model is enough.</p>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="notice" role="status">
        <p>Sizing up the prompt…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="notice notice-error" role="alert">
        <p>Router not reachable: {state.message}</p>
        <p className="muted">
          Start it with <code>demo/rightsize/run.sh</code>.
        </p>
      </div>
    );
  }

  const { result } = state;
  const chance = pct(result.pStrong);
  const threshold = pct(result.threshold);
  return (
    <div className="meter-block" role="status" aria-busy={state.refreshing}>
      <p className={`route-verdict route-${result.recommend}`}>{VERDICT[result.recommend]}</p>
      <p>{result.message}</p>
      <div className="readouts">
        <span>
          big model helps <b>{chance}%</b>
        </span>
        <span>
          threshold <b>{threshold}%</b>
        </span>
      </div>
      <div className="route-bar">
        <meter
          className="meter"
          min={0}
          max={100}
          value={chance}
          aria-label="Chance that a big model gives a clearly better answer"
          aria-valuetext={`${chance}%, threshold ${threshold}%`}
        >
          {chance}%
        </meter>
        <span className="route-tick" style={{ left: `${threshold}%` }} aria-hidden="true" />
      </div>
      {result.why && <p className="muted">{result.why}</p>}
      <p className="tag">
        {result.router} · {Math.round(result.latencyMs)} ms
      </p>
    </div>
  );
}
