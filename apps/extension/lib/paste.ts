import { buildTranscript, type Transcript } from "@shoal/core";

/**
 * Fallback when a site adapter cannot read the page: the user pastes the conversation with a speaker label at the
 * start of each message ("User:", "Claude:" and so on). A final user message becomes the draft.
 */

const SPEAKER = /^\s*(user|you|me|human|assistant|ai|claude|chatgpt|gpt|gemini|model|bot)\s*:\s*/i;
const USER_LABELS = new Set(["user", "you", "me", "human"]);

export function parsePastedConversation(text: string, capturedAt?: string): Transcript | null {
  const turns: { role: "user" | "assistant"; lines: string[] }[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const match = SPEAKER.exec(line);
    if (match?.[1]) {
      turns.push({
        role: USER_LABELS.has(match[1].toLowerCase()) ? "user" : "assistant",
        lines: [line.slice(match[0].length)],
      });
    } else if (turns.length > 0) {
      turns.at(-1)?.lines.push(line);
    }
  }
  const raw = turns.map((t) => ({ role: t.role, text: t.lines.join("\n").trim() })).filter((t) => t.text);
  if (raw.length < 2) return null;

  const last = raw.at(-1);
  const draft = last?.role === "user" ? last.text : "";
  return buildTranscript({
    site: "generic",
    conversationId: "pasted",
    draft,
    turns: draft ? raw.slice(0, -1) : raw,
    ...(capturedAt ? { capturedAt } : {}),
  });
}
