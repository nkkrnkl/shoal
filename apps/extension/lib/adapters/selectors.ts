import type { Site } from "@shoal/core";

/** Selectors for one role's messages. */
export interface TurnSelectors {
  /** Candidates for the element wrapping one message. The first candidate that matches anything wins. */
  container: string[];
  /** Candidates for the text inside a container. The first that matches is read; else the container itself. */
  text?: string[];
}

export interface SiteSelectors {
  /** Candidates for the prompt input. The first that matches wins. */
  draft: string[];
  turns: { user: TurnSelectors; assistant: TurnSelectors };
  /** Regex sources run against `location.pathname`. Group 1 is the conversation ID. The first match wins. */
  conversationPath: string[];
}

/**
 * Every DOM selector Shoal uses to read chat pages, in one place so it can move to remote config (#19).
 * None of these were checked against the live sites. They come from best knowledge of each site's markup
 * and are exercised against hand-made fixtures in `test/fixtures/`. Entries marked "Check live" are the
 * least certain. Prefer data attributes and custom element names over class names.
 */
export const SELECTORS: Record<Site, SiteSelectors> = {
  "claude.ai": {
    draft: [
      // Check live: the ProseMirror editor is believed to sit inside a chat-input test ID.
      '[data-testid="chat-input"] [contenteditable="true"]',
      '[data-testid="chat-input"][contenteditable="true"]',
      // Check live: class name from ProseMirror itself, fairly stable but not Claude-specific.
      'div.ProseMirror[contenteditable="true"]',
      'fieldset [contenteditable="true"]',
    ],
    turns: {
      user: {
        container: ['[data-testid="user-message"]'],
      },
      assistant: {
        container: [
          // Check live: speculative test ID, used first in case Claude adds one.
          '[data-testid="assistant-message"]',
          // Check live: class names, the least robust hook. Newer and older names.
          ".font-claude-response",
          ".font-claude-message",
        ],
      },
    },
    // /chat/<uuid>
    conversationPath: ["/chat/([\\w-]+)"],
  },
  "chatgpt.com": {
    draft: [
      // The composer has used this ID both as a textarea and as a ProseMirror contenteditable div.
      "#prompt-textarea",
      // Check live: older textarea fallback.
      'textarea[name="prompt-textarea"]',
      'form [contenteditable="true"]',
    ],
    turns: {
      user: {
        container: ['[data-message-author-role="user"]'],
        // Check live: inner text wrapper for user bubbles.
        text: [".whitespace-pre-wrap"],
      },
      assistant: {
        container: ['[data-message-author-role="assistant"]'],
        // Check live: the rendered markdown body.
        text: [".markdown"],
      },
    },
    // /c/<uuid>, also /g/<gpt or project>/c/<uuid>
    conversationPath: ["/c/([\\w-]+)"],
  },
  "gemini.google.com": {
    draft: [
      // Check live: Quill editor inside Gemini's rich-textarea custom element.
      "rich-textarea .ql-editor",
      'div.ql-editor[contenteditable="true"]',
      // Check live: aria label is locale-dependent.
      '[contenteditable="true"][aria-label*="prompt" i]',
    ],
    turns: {
      user: {
        // Angular custom element names, more stable than classes.
        container: ["user-query"],
        // Check live: skips the visually hidden "You said" label.
        text: [".query-text", "user-query-content"],
      },
      assistant: {
        container: ["model-response"],
        // Check live: message-content holds the answer, without the toolbar and "Show thinking" chrome.
        text: ["message-content", ".markdown"],
      },
    },
    // /app/<id>, /u/1/app/<id>, /gem/<gem>/<id>
    conversationPath: ["/app/([\\w-]+)", "/gem/[\\w-]+/([\\w-]+)"],
  },
  generic: {
    // Any textarea or contenteditable host. The generic reader picks the focused or largest visible one.
    draft: ["textarea", '[contenteditable]:not([contenteditable="false"])'],
    turns: { user: { container: [] }, assistant: { container: [] } },
    conversationPath: [],
  },
};
