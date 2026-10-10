import { describe, expect, it } from "vitest";
import { detectSite } from "../lib/site";

describe("detectSite", () => {
  it.each([
    ["https://claude.ai/chat/123", "claude.ai"],
    ["https://chatgpt.com/c/abc", "chatgpt.com"],
    ["https://gemini.google.com/app", "gemini.google.com"],
    ["https://example.com", "generic"],
    ["not a url", "generic"],
  ])("%s -> %s", (url, site) => {
    expect(detectSite(url)).toBe(site);
  });
});
