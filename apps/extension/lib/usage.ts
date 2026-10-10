/**
 * Reads the user's plan usage on claude.ai, so the budget does not have to be set by hand.
 *
 * claude.ai has no public interface for this. The reader calls the internal address that the site's own
 * Settings > Usage page uses, from the content script, with the user's own session. Nothing leaves the
 * browser. The address and its fields are unofficial and can change without notice, so every step is
 * checked, and a failure means "usage unknown": the panel then falls back to the manual slider.
 */

export interface UsageWindow {
  /** Short name for people: "session", "week", or the field name with spaces. */
  name: string;
  /** Share of this window's limit that is used, 0 to 100. */
  usedPct: number;
  /** ISO time when the window resets, when the site gives one. */
  resetsAt: string | null;
}

export interface PlanUsage {
  /** The fullest window: the limit the user reaches first. */
  usedPct: number;
  windows: UsageWindow[];
}

const WINDOW_NAMES: Record<string, string> = {
  five_hour: "session",
  seven_day: "week",
};

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/**
 * Converts the usage answer. It keeps every top-level field that holds a numeric `utilization`
 * (for example `five_hour` and `seven_day`), and ignores the rest. Returns null when there is none.
 */
export function parsePlanUsage(value: unknown): PlanUsage | null {
  if (typeof value !== "object" || value === null) return null;
  const windows: UsageWindow[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== "object" || field === null) continue;
    const { utilization, resets_at: resetsAt } = field as { utilization?: unknown; resets_at?: unknown };
    if (typeof utilization !== "number" || !Number.isFinite(utilization)) continue;
    windows.push({
      name: WINDOW_NAMES[key] ?? key.replaceAll("_", " "),
      usedPct: clampPct(utilization),
      resetsAt: typeof resetsAt === "string" ? resetsAt : null,
    });
  }
  if (windows.length === 0) return null;
  return { usedPct: Math.max(...windows.map((w) => w.usedPct)), windows };
}

/** Picks the organization to ask about: the last active one when it is in the list, else the first. */
export function pickOrgId(orgs: unknown, lastActive: string | null): string | null {
  if (!Array.isArray(orgs)) return null;
  const ids = orgs
    .map((org: unknown) => (typeof org === "object" && org !== null ? (org as { uuid?: unknown }).uuid : null))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (lastActive && ids.includes(lastActive)) return lastActive;
  return ids[0] ?? null;
}

/** Reads the `lastActiveOrg` cookie that claude.ai sets, when it is readable. */
export function lastActiveOrg(cookie: string): string | null {
  return /(?:^|;\s*)lastActiveOrg=([^;]+)/.exec(cookie)?.[1] ?? null;
}

/**
 * Asks claude.ai for the signed-in user's plan usage. Call it from the content script on claude.ai only.
 * Throws when a request fails; returns null when the answer has no usage windows.
 */
export async function readClaudeUsage(cookie: string = document.cookie): Promise<PlanUsage | null> {
  const getJson = async (path: string): Promise<unknown> => {
    const response = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${path} returned ${response.status}`);
    return response.json();
  };
  const org = pickOrgId(await getJson("/api/organizations"), lastActiveOrg(cookie));
  if (!org) return null;
  return parsePlanUsage(await getJson(`/api/organizations/${encodeURIComponent(org)}/usage`));
}
