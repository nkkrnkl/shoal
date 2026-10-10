import type { Transcript } from "@shoal/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPageWatcher, draftChanged } from "../lib/page-watch";

const page = (ids: string[], draft = ""): Transcript => ({
  site: "claude.ai",
  conversationId: "c",
  draft,
  capturedAt: "2026-10-10T12:00:00Z",
  turns: ids.map((id, index) => ({
    id,
    index,
    role: index % 2 ? "assistant" : "user",
    text: id,
    blocks: [],
    tokens: 1,
  })),
});

describe("createPageWatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports once after the page goes quiet, with the reason", () => {
    let current = page(["a"]);
    const onChange = vi.fn();
    const w = createPageWatcher({ read: () => current, onChange, quietMs: 2000 });

    // Initial read reports the turns.
    w.poke();
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenLastCalledWith(current, "turns");

    // A streaming answer: many mutations, one report after it settles.
    for (let i = 0; i < 20; i++) {
      current = page(["a", `b${i}`]);
      w.poke();
      vi.advanceTimersByTime(100);
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith(current, "turns");

    // Typing a draft reports "draft"; nothing changed reports nothing.
    current = page(["a", "b19"], "How much should I run today for marathon training?");
    w.poke();
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenLastCalledWith(current, "draft");
    w.poke();
    vi.advanceTimersByTime(2000);
    expect(onChange).toHaveBeenCalledTimes(3);
    w.stop();
  });

  it("ignores pages it cannot read", () => {
    const onChange = vi.fn();
    const w = createPageWatcher({ read: () => null, onChange, quietMs: 10 });
    w.poke();
    vi.advanceTimersByTime(10);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("draftChanged", () => {
  it("ignores single keystrokes and catches real edits", () => {
    expect(draftChanged("How much should I run", "How much should I run?")).toBe(false);
    expect(draftChanged("How much should I run", "How much should I run today, and how fast?")).toBe(true);
    expect(draftChanged("", "hi")).toBe(true);
    expect(draftChanged("something", "")).toBe(true);
    expect(draftChanged("Write a poem about cats", "Write a story about dogs")).toBe(true);
  });
});
