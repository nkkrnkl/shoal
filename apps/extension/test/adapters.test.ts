// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TranscriptSchema } from "@shoal/core";
import { afterEach, describe, expect, it } from "vitest";
import { getAdapter, readPageTranscript } from "../lib/adapters";
import { chatgptAdapter } from "../lib/adapters/chatgpt";
import { claudeAdapter } from "../lib/adapters/claude";
import { geminiAdapter } from "../lib/adapters/gemini";
import { genericAdapter } from "../lib/adapters/generic";

function load(name: string): Document {
  document.body.innerHTML = readFileSync(join(import.meta.dirname, "fixtures", `${name}.html`), "utf8");
  return document;
}

function path(pathname: string) {
  return { pathname };
}

/** happy-dom has no layout, so give elements a size by hand. */
function setSize(el: Element, width: number, height: number) {
  el.getBoundingClientRect = () => ({ width, height }) as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("claude.ai adapter", () => {
  it("reads turns in order, keeping code as plain text", () => {
    const turns = claudeAdapter.readTurns(load("claude"));
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "user", "assistant"]);
    expect(turns[0]?.text).toBe("Write a sort in Python");
    expect(turns[1]?.text).toContain("Here is a simple version:");
    // happy-dom's innerText collapses <pre> whitespace; Chrome keeps the code's line breaks.
    expect(turns[1]?.text).toMatch(/def sort\(xs\):\s+return sorted\(xs\)/);
    expect(turns[1]?.text).not.toContain("Retry");
    expect(turns[2]?.text).toBe("");
    expect(turns[4]?.text).toBe("Use sorted(xs, reverse=True).");
  });

  it("reads the draft from the composer", () => {
    expect(claudeAdapter.readDraft(load("claude"))).toBe("Also handle empty lists");
  });

  it.each([
    ["/chat/0b9a1c2d-0000-4000-8000-000000000002", "0b9a1c2d-0000-4000-8000-000000000002"],
    ["/new", "new"],
    ["/project/abc", "new"],
    ["/", "new"],
  ])("conversationId(%s) -> %s", (pathname, id) => {
    expect(claudeAdapter.conversationId(path(pathname))).toBe(id);
  });
});

describe("chatgpt.com adapter", () => {
  it("reads turns by author role", () => {
    const turns = chatgptAdapter.readTurns(load("chatgpt"));
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user"]);
    expect(turns[0]?.text).toBe("What is a monad?");
    expect(turns[0]?.text).not.toContain("You said");
    expect(turns[1]?.text).toContain("A monad is a design pattern.");
    expect(turns[1]?.text).toContain("return x >>= f");
    expect(turns[2]?.text).toBe("Give an example in TypeScript");
  });

  it("reads the draft from #prompt-textarea, as a div or a textarea", () => {
    expect(chatgptAdapter.readDraft(load("chatgpt"))).toBe("Shorter please");
    document.body.innerHTML = '<textarea id="prompt-textarea"></textarea>';
    (document.getElementById("prompt-textarea") as HTMLTextAreaElement).value = "  typed text ";
    expect(chatgptAdapter.readDraft(document)).toBe("typed text");
  });

  it.each([
    ["/c/68f0aa00-1111-4222-8333-444455556666", "68f0aa00-1111-4222-8333-444455556666"],
    ["/g/g-p-abc123-project/c/68f0aa00-1111-4222-8333-444455556667", "68f0aa00-1111-4222-8333-444455556667"],
    ["/", "new"],
    ["/g/g-abc123-my-gpt", "new"],
  ])("conversationId(%s) -> %s", (pathname, id) => {
    expect(chatgptAdapter.conversationId(path(pathname))).toBe(id);
  });
});

describe("gemini.google.com adapter", () => {
  it("reads user queries and model responses without page chrome", () => {
    const turns = geminiAdapter.readTurns(load("gemini"));
    expect(turns).toEqual([
      { role: "user", text: "Plan a three day trip to Lisbon" },
      { role: "assistant", text: "Day 1: Alfama and the castle." },
      { role: "user", text: "Make day 2 cheaper" },
    ]);
  });

  it("reads the draft from the rich textarea", () => {
    expect(geminiAdapter.readDraft(load("gemini"))).toBe("And add a food tour");
  });

  it.each([
    ["/app/1a2b3c4d5e6f7a8b", "1a2b3c4d5e6f7a8b"],
    ["/u/1/app/1a2b3c4d5e6f7a8b", "1a2b3c4d5e6f7a8b"],
    ["/gem/coding-partner/9f8e7d6c5b4a", "9f8e7d6c5b4a"],
    ["/app", "new"],
  ])("conversationId(%s) -> %s", (pathname, id) => {
    expect(geminiAdapter.conversationId(path(pathname))).toBe(id);
  });
});

describe("generic adapter", () => {
  it("returns no turns and a new conversation", () => {
    expect(genericAdapter.readTurns(load("chatgpt"))).toEqual([]);
    expect(genericAdapter.conversationId(path("/c/abc"))).toBe("new");
  });

  it("prefers the focused editable element", () => {
    document.body.innerHTML = '<textarea id="a"></textarea><div id="b" contenteditable="true">focused</div>';
    setSize(document.getElementById("a") as Element, 500, 500);
    (document.getElementById("a") as HTMLTextAreaElement).value = "bigger";
    (document.getElementById("b") as HTMLElement).focus();
    expect(genericAdapter.readDraft(document)).toBe("focused");
  });

  it("falls back to the largest visible editable element", () => {
    document.body.innerHTML =
      '<textarea id="small"></textarea><textarea id="big"></textarea><div id="hidden" contenteditable="true">x</div>';
    const small = document.getElementById("small") as HTMLTextAreaElement;
    const big = document.getElementById("big") as HTMLTextAreaElement;
    small.value = "small";
    big.value = "big draft";
    setSize(small, 100, 20);
    setSize(big, 600, 120);
    setSize(document.getElementById("hidden") as Element, 0, 0);
    expect(genericAdapter.readDraft(document)).toBe("big draft");
  });

  it("returns an empty draft when there is no input", () => {
    document.body.innerHTML = "<p>Nothing to type into</p>";
    expect(genericAdapter.readDraft(document)).toBe("");
  });

  it("is used by site adapters when their composer is missing", () => {
    document.body.innerHTML = '<textarea id="t"></textarea>';
    const t = document.getElementById("t") as HTMLTextAreaElement;
    t.value = "fallback";
    setSize(t, 100, 100);
    expect(claudeAdapter.readDraft(document)).toBe("fallback");
  });
});

describe("readPageTranscript", () => {
  it("builds a valid transcript with stable IDs and no empty turns", () => {
    const doc = load("claude");
    const loc = path("/chat/0b9a1c2d-0000-4000-8000-000000000002");
    const a = readPageTranscript("claude.ai", doc, loc);
    const b = readPageTranscript("claude.ai", doc, loc);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(TranscriptSchema.safeParse(a.transcript).success).toBe(true);
    expect(a.adapter).toBe("claude.ai");
    expect(a.transcript.conversationId).toBe("0b9a1c2d-0000-4000-8000-000000000002");
    expect(a.transcript.draft).toBe("Also handle empty lists");
    expect(a.transcript.turns).toHaveLength(4);
    expect(b.transcript.turns.map((t) => t.id)).toEqual(a.transcript.turns.map((t) => t.id));
  });

  it("returns ok with zero turns on a supported site with no messages", () => {
    document.body.innerHTML = "<main></main>";
    const r = readPageTranscript("gemini.google.com", document, path("/app"));
    expect(r).toMatchObject({ ok: true, adapter: "gemini.google.com" });
    if (r.ok) expect(r.transcript.turns).toEqual([]);
  });

  it("returns ok: false when an adapter throws", () => {
    const adapter = getAdapter("generic");
    const original = adapter.readTurns;
    adapter.readTurns = () => {
      throw new Error("boom");
    };
    try {
      expect(readPageTranscript("generic", document, path("/"))).toEqual({ ok: false, error: "boom" });
    } finally {
      adapter.readTurns = original;
    }
  });
});
