import { describe, expect, it } from "vitest";
import { buildTranscript, estimateTokens, fnv1a, type RawTurn, TranscriptSchema } from "../src/index.ts";

const capturedAt = "2026-10-10T12:00:00.000Z";

const turns: RawTurn[] = [
  { role: "user", text: "Write a sort in Python" },
  { role: "assistant", text: "def sort(xs):\n    return sorted(xs)" },
  { role: "user", text: "Now make it descending" },
];

function build(raw: RawTurn[], draft = "") {
  return buildTranscript({ site: "generic", conversationId: "c", draft, turns: raw, capturedAt });
}

describe("fnv1a", () => {
  it("matches known FNV-1a 32-bit vectors", () => {
    expect(fnv1a("")).toBe("811c9dc5");
    expect(fnv1a("a")).toBe("e40c292c");
    expect(fnv1a("foobar")).toBe("bf9cf968");
  });
});

describe("estimateTokens", () => {
  it.each([
    ["", 0],
    ["a", 1],
    ["abcd", 1],
    ["abcde", 2],
    ["x".repeat(400), 100],
  ])("%j -> %i", (text, tokens) => {
    expect(estimateTokens(text)).toBe(tokens);
  });
});

describe("buildTranscript", () => {
  it("produces a transcript that passes the schema", () => {
    const t = buildTranscript({ site: "claude.ai", conversationId: "abc", draft: "hi", turns, capturedAt });
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
    expect(t.site).toBe("claude.ai");
    expect(t.draft).toBe("hi");
    expect(t.turns.map((turn) => turn.index)).toEqual([0, 1, 2]);
    expect(t.turns[0]?.blocks).toEqual([{ kind: "text", text: "Write a sort in Python" }]);
    expect(t.capturedAt).toBe(capturedAt);
  });

  it("defaults capturedAt to a valid ISO timestamp", () => {
    const t = buildTranscript({ site: "generic", conversationId: "new", draft: "", turns: [] });
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
  });

  it("gives the same IDs when the same conversation is read twice", () => {
    const a = build(turns);
    const b = buildTranscript({
      site: "generic",
      conversationId: "c",
      draft: "a different draft",
      turns: turns.map((turn) => ({ ...turn })),
    });
    expect(b.turns.map((turn) => turn.id)).toEqual(a.turns.map((turn) => turn.id));
  });

  it("ignores surrounding whitespace when building IDs", () => {
    const a = build(turns);
    const b = build(turns.map((turn) => ({ ...turn, text: `\n  ${turn.text}  \n` })));
    expect(b.turns.map((turn) => turn.id)).toEqual(a.turns.map((turn) => turn.id));
  });

  it("changes the ID when the text or role changes", () => {
    const base = build(turns);
    const edited = build([{ role: "user", text: "Write a sort in Rust" }, ...turns.slice(1)]);
    const swapped = build([{ role: "assistant", text: "Write a sort in Python" }]);
    expect(edited.turns[0]?.id).not.toBe(base.turns[0]?.id);
    expect(edited.turns[1]?.id).toBe(base.turns[1]?.id);
    expect(swapped.turns[0]?.id).not.toBe(base.turns[0]?.id);
  });

  it("keeps IDs unique for repeated identical turns", () => {
    const t = build([
      { role: "user", text: "continue" },
      { role: "user", text: "continue" },
    ]);
    expect(new Set(t.turns.map((turn) => turn.id)).size).toBe(2);
  });

  it("drops empty turns before indexing", () => {
    const [first, second] = turns as [RawTurn, RawTurn];
    const t = build([{ role: "user", text: "   " }, first, { role: "assistant", text: "" }, second]);
    expect(t.turns).toHaveLength(2);
    expect(t.turns.map((turn) => turn.index)).toEqual([0, 1]);
    expect(t.turns.map((turn) => turn.id)).toEqual(build([first, second]).turns.map((turn) => turn.id));
  });

  it("estimates tokens per turn and keeps given blocks", () => {
    const blocks = [{ kind: "code" as const, text: "print(1)", language: "python" }];
    const t = build([{ role: "assistant", text: "print(1)", blocks }]);
    expect(t.turns[0]?.tokens).toBe(2);
    expect(t.turns[0]?.blocks).toEqual(blocks);
  });

  it('falls back to "new" for an empty conversation ID', () => {
    const t = buildTranscript({ site: "generic", conversationId: "", draft: "", turns: [], capturedAt });
    expect(t.conversationId).toBe("new");
  });
});
