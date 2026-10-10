import type { Turn } from "@shoal/core";
import { SELECTORS, type SiteSelectors, type TurnSelectors } from "./selectors";
import type { AdapterTurn } from "./types";

/** Rendered text of an element, trimmed. Code blocks come through as plain text. Never evaluated. */
export function readText(el: Element): string {
  const html = el as HTMLElement;
  const text = typeof html.innerText === "string" ? html.innerText : (el.textContent ?? "");
  return text.trim();
}

/** Text of an input: the value of a textarea or input, else its rendered text. */
export function readEditable(el: Element): string {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return (el as HTMLTextAreaElement).value.trim();
  return readText(el);
}

/** The first element matching any candidate, tried in order. Invalid selectors are skipped. */
export function firstMatch(root: ParentNode, candidates: readonly string[]): Element | null {
  for (const selector of candidates) {
    const el = safeQuery(() => root.querySelector(selector));
    if (el) return el;
  }
  return null;
}

/** All elements for the first candidate that matches anything, without elements nested in another match. */
function allForFirstMatch(root: ParentNode, candidates: readonly string[]): Element[] {
  for (const selector of candidates) {
    const found = safeQuery(() => Array.from(root.querySelectorAll(selector))) ?? [];
    if (found.length > 0) return found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
  }
  return [];
}

function safeQuery<T>(query: () => T): T | null {
  try {
    return query();
  } catch {
    // An invalid selector, for example from a future remote config. Try the next one.
    return null;
  }
}

function collect(doc: Document, role: Turn["role"], selectors: TurnSelectors): { el: Element; turn: AdapterTurn }[] {
  return allForFirstMatch(doc, selectors.container).map((el) => {
    const target = (selectors.text && firstMatch(el, selectors.text)) || el;
    return { el, turn: { role, text: readText(target) } };
  });
}

/** Reads user and assistant messages and merges them in document order. */
export function readTurnsWith(doc: Document, selectors: SiteSelectors): AdapterTurn[] {
  const found = [
    ...collect(doc, "user", selectors.turns.user),
    ...collect(doc, "assistant", selectors.turns.assistant),
  ];
  found.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  return found.map((f) => f.turn);
}

/** The first capture group of the first matching path pattern, or "new". */
export function conversationIdFrom(pathname: string, patterns: readonly string[]): string {
  for (const pattern of patterns) {
    const id = new RegExp(pattern).exec(pathname)?.[1];
    if (id) return id;
  }
  return "new";
}

function isVisible(el: Element): boolean {
  const withCheck = el as Element & { checkVisibility?: () => boolean };
  if (typeof withCheck.checkVisibility === "function" && !withCheck.checkVisibility()) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** The draft in the focused editable element, else in the largest visible one. Empty when there is none. */
export function readGenericDraft(doc: Document): string {
  const editable = SELECTORS.generic.draft.join(", ");
  const active = doc.activeElement;
  if (active?.matches(editable)) return readEditable(active);
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of Array.from(doc.querySelectorAll(editable))) {
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best ? readEditable(best) : "";
}
