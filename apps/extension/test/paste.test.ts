import { TranscriptSchema } from "@shoal/core";
import { describe, expect, it } from "vitest";
import { parsePastedConversation } from "../lib/paste";

describe("parsePastedConversation", () => {
  it("splits on speaker labels and keeps multi-line messages", () => {
    const t = parsePastedConversation(
      "You: Write a sort in Python.\nClaude: Here it is:\n\ndef sort(xs):\n    return sorted(xs)\nUser: Now make it stable.",
    );
    expect(t).not.toBeNull();
    expect(TranscriptSchema.safeParse(t).success).toBe(true);
    expect(t?.turns.map((x) => x.role)).toEqual(["user", "assistant"]);
    expect(t?.turns[1]?.text).toContain("return sorted(xs)");
    // A final user message becomes the draft.
    expect(t?.draft).toBe("Now make it stable.");
  });

  it("keeps the last turn when it is the assistant's", () => {
    const t = parsePastedConversation("user: hi\nassistant: hello");
    expect(t?.turns).toHaveLength(2);
    expect(t?.draft).toBe("");
  });

  it("returns null without at least two labeled messages", () => {
    expect(parsePastedConversation("just some text")).toBeNull();
    expect(parsePastedConversation("User: only one")).toBeNull();
  });
});
