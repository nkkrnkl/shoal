import type { Transcript } from "@shoal/core";

/**
 * Watches a chat page and reports when it is worth analyzing again. Pages change constantly while an answer
 * streams, so changes are reported only after the page has been quiet for a while.
 * - "turns": a message was added, edited or finished streaming. Worth a full context analysis.
 * - "draft": the message being typed changed meaningfully. Worth new suggestions only.
 */

export type ChangeReason = "turns" | "draft";

export interface PageWatcherOptions {
  /** Reads the page now; returns null when it cannot be read. */
  read: () => Transcript | null;
  onChange: (transcript: Transcript, reason: ChangeReason) => void;
  /** How long the page must stay unchanged before it is read. */
  quietMs?: number;
}

export interface PageWatcher {
  /** Call on any page mutation or input event. Cheap: it only restarts the quiet timer. */
  poke: () => void;
  stop: () => void;
}

export function turnsSignature(t: Transcript): string {
  return t.turns.map((x) => x.id).join("|");
}

/** A draft counts as changed once it differs by at least a few characters, so single keystrokes do not count. */
export function draftChanged(previous: string, next: string): boolean {
  const a = previous.trim();
  const b = next.trim();
  if (a === b) return false;
  if (!a || !b) return true;
  return Math.abs(a.length - b.length) >= 8 || !b.startsWith(a.slice(0, Math.min(a.length, 20)));
}

export function createPageWatcher({ read, onChange, quietMs = 2_000 }: PageWatcherOptions): PageWatcher {
  let lastTurns: string | null = null;
  let lastDraft = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    timer = undefined;
    const t = read();
    if (!t) return;
    const turns = turnsSignature(t);
    if (turns !== lastTurns) {
      lastTurns = turns;
      lastDraft = t.draft;
      onChange(t, "turns");
    } else if (draftChanged(lastDraft, t.draft)) {
      lastDraft = t.draft;
      onChange(t, "draft");
    }
  };

  const poke = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(check, quietMs);
  };

  return {
    poke,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
