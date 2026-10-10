import "@/assets/router.css";
import type { Site } from "@shoal/core";
import { type RouteResult, type RouterSettings, verdictText } from "@/lib/router";
import type { PlanUsage } from "@/lib/usage";

export type RecommendationState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: RouteResult; refreshing: boolean; site: Site };

export interface RecommendationProps {
  state: RecommendationState;
  settings: RouterSettings;
  onSettingsChange: (next: RouterSettings) => void;
  /** Plan usage as the chat site reports it, or null when unknown. */
  usage: PlanUsage | null;
  /** The budget in effect, 0 to 100: from `usage` when `settings.auto` is on, else from the slider. */
  budget: number;
}

function pct(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 100);
}

/** Renders the router's advice for the draft prompt, and the budget controls that move its threshold. */
export function Recommendation({ state, settings, onSettingsChange, usage, budget }: RecommendationProps) {
  const fromSite = settings.auto && usage !== null;
  return (
    <div className="route">
      <RecommendationBody state={state} />
      <div className="route-budget">
        {fromSite ? (
          <div className="route-slider">
            <span className="readouts">
              <span>
                plan usage left <b>{budget}%</b>
              </span>
            </span>
            <p className="muted" data-testid="usage-source">
              Read from your plan: {usage.windows.map((w) => `${w.name} ${Math.round(w.usedPct)}% used`).join(" · ")}
            </p>
          </div>
        ) : (
          <label className="route-slider">
            <span className="readouts">
              <span>
                plan usage left <b>{budget}%</b>
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
        )}
        {usage !== null && (
          <label className="route-check">
            <input
              type="checkbox"
              checked={!settings.auto}
              onChange={(e) => onSettingsChange({ ...settings, auto: !e.target.checked })}
            />
            <span>Set the usage by hand</span>
          </label>
        )}
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
      <p className={`route-verdict route-${result.recommend}`}>{verdictText(result.recommend, state.site)}</p>
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
