/**
 * Provider clients implementing the LLMClient contract from @shoal/core.
 * Gemini is the first adapter; Anthropic follows when the extension needs it.
 */
export type { CompletionRequest, CompletionResult, LLMClient, Provider } from "@shoal/core";
export * from "./gemini.ts";
