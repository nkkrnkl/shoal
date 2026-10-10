import type { Site } from "@shoal/core";

/**
 * Reads the draft prompt and the selected model from a chat page. First cut of the site adapters:
 * the draft and the model only, no conversation turns yet. Page text is untrusted data.
 */

export interface Draft {
  text: string;
  /** The model name shown in the page's model picker, or null when none was found. */
  model: string | null;
}

/** Model names to look for in each site's model picker. Best-effort: the pickers change without notice. */
export const PICKER_NAMES: Record<Site, string[]> = {
  "claude.ai": ["Fable", "Opus", "Sonnet", "Haiku"],
  "gemini.google.com": ["Deep Think", "Thinking", "Flash-Lite", "Flash", "Pro", "Fast"],
  "chatgpt.com": ["Thinking", "Instant", "mini", "Pro", "Auto"],
  generic: [],
};

const POLL_MS = 300;
const UPSELL = /upgrade|try|get /i;

/** Picks the first button label that names a model. Skips long labels and upsell buttons. */
export function pickModelLabel(labels: Iterable<string>, site: Site): string | null {
  const names = PICKER_NAMES[site];
  for (const raw of labels) {
    const label = raw.trim();
    if (!label || label.length > 40 || UPSELL.test(label)) continue;
    if (names.some((name) => label.includes(name))) return label;
  }
  return null;
}

function isPromptBox(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && (el.tagName === "TEXTAREA" || el.isContentEditable);
}

/**
 * The focused box first. Then the box found before, so the draft is still read while the side panel
 * has focus. Then the first editable box on the page.
 */
function findPromptBox(doc: Document, previous: HTMLElement | null): HTMLElement | null {
  if (isPromptBox(doc.activeElement)) return doc.activeElement;
  if (previous?.isConnected) return previous;
  return doc.querySelector<HTMLElement>('[contenteditable="true"], textarea');
}

function readText(box: HTMLElement): string {
  return (box instanceof HTMLTextAreaElement ? box.value : box.innerText) || "";
}

function detectModel(doc: Document, site: Site): string | null {
  const buttons = doc.querySelectorAll<HTMLElement>('button, [role="button"], [aria-haspopup]');
  return pickModelLabel(
    Array.from(buttons, (el) => el.innerText || ""),
    site,
  );
}

/**
 * Calls `onChange` when the draft text or the selected model changes. Returns a function that stops it.
 * The page is read on a timer. `input` events are not enough: the editors of these sites handle paste
 * themselves, and then the browser sends no `input` event. The model picker is read on every third
 * tick, because that scan touches every button.
 */
export function watchDraft(site: Site, onChange: (draft: Draft) => void, doc: Document = document): () => void {
  let box: HTMLElement | null = null;
  let model: string | null = null;
  let seen: Draft | null = null;
  let tick = 0;
  const timer = setInterval(() => {
    box = findPromptBox(doc, box);
    const text = box ? readText(box).trim() : "";
    if (tick++ % 3 === 0) model = detectModel(doc, site);
    if (seen && seen.text === text && seen.model === model) return;
    seen = { text, model };
    onChange(seen);
  }, POLL_MS);
  return () => clearInterval(timer);
}
