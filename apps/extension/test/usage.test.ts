import { describe, expect, it } from "vitest";
import { lastActiveOrg, parsePlanUsage, pickOrgId } from "../lib/usage";

describe("parsePlanUsage", () => {
  it("keeps every window with a utilization and reports the fullest one", () => {
    const usage = parsePlanUsage({
      five_hour: { utilization: 37, resets_at: "2026-10-10T19:00:00Z" },
      seven_day: { utilization: 12.4, resets_at: null },
      seven_day_opus: { utilization: 61 },
      extra_usage: null,
      cedar_ember: { eligible: true },
    });
    expect(usage).toEqual({
      usedPct: 61,
      windows: [
        { name: "session", usedPct: 37, resetsAt: "2026-10-10T19:00:00Z" },
        { name: "week", usedPct: 12.4, resetsAt: null },
        { name: "seven day opus", usedPct: 61, resetsAt: null },
      ],
    });
  });

  it("clamps values outside 0 to 100", () => {
    expect(parsePlanUsage({ five_hour: { utilization: 140 }, seven_day: { utilization: -3 } })?.windows).toEqual([
      { name: "session", usedPct: 100, resetsAt: null },
      { name: "week", usedPct: 0, resetsAt: null },
    ]);
  });

  it.each([
    ["null", null],
    ["text", "ok"],
    ["an object without windows", { message: "not found" }],
    ["utilization sent as text", { five_hour: { utilization: "37" } }],
  ])("returns null for %s", (_name, value) => {
    expect(parsePlanUsage(value)).toBeNull();
  });
});

describe("pickOrgId", () => {
  const orgs = [{ uuid: "org-a", name: "Personal" }, { uuid: "org-b" }, { name: "no id" }];

  it("prefers the last active organization when it is in the list", () => {
    expect(pickOrgId(orgs, "org-b")).toBe("org-b");
  });

  it("falls back to the first organization", () => {
    expect(pickOrgId(orgs, null)).toBe("org-a");
    expect(pickOrgId(orgs, "org-gone")).toBe("org-a");
  });

  it("returns null when the answer is not a list of organizations", () => {
    expect(pickOrgId({ error: "unauthorized" }, null)).toBeNull();
    expect(pickOrgId([], null)).toBeNull();
  });
});

describe("lastActiveOrg", () => {
  it("reads the cookie when present", () => {
    expect(lastActiveOrg("a=1; lastActiveOrg=org-b; theme=dark")).toBe("org-b");
    expect(lastActiveOrg("lastActiveOrg=org-a")).toBe("org-a");
    expect(lastActiveOrg("a=1; theme=dark")).toBeNull();
  });
});
