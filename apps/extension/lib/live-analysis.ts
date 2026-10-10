import {
  AnalyzerOutputError,
  AuthError,
  analyzeContext,
  type ContextAnalysis,
  type DraftSuggestions,
  type LLMClient,
  RateLimitError,
  RefusalError,
  suggestForDraft,
  type Transcript,
  TranscriptTooLongError,
} from "@shoal/core";
import { GeminiClient } from "@shoal/providers";
import type { Settings } from "@/lib/settings";

export interface LiveAnalysis {
  analysis: ContextAnalysis;
  transcript: Transcript;
}

/** A failure the side panel can show as is. */
export class AnalysisError extends Error {
  override readonly name = "AnalysisError";
  constructor(
    message: string,
    /** True when the fix is in settings, so the panel can offer a link there. */
    readonly needsSettings = false,
  ) {
    super(message);
  }
}

/** Reads the conversation, runs the analyzer with the user's key and turns failures into plain messages. */
export async function runLiveAnalysis(
  getTranscript: () => Promise<Transcript>,
  settings: Settings,
  client: LLMClient = new GeminiClient({ apiKey: settings.geminiApiKey }),
): Promise<LiveAnalysis> {
  if (!settings.geminiApiKey) throw new AnalysisError("Add a Gemini API key in settings first.", true);
  const transcript = await getTranscript();
  if (transcript.turns.length === 0) {
    throw new AnalysisError("No conversation found on this page. Open a chat with a few messages and try again.");
  }
  try {
    const analysis = await analyzeContext(client, transcript, { model: settings.analyzerModel });
    return { analysis, transcript };
  } catch (err) {
    throw toAnalysisError(err);
  }
}

/** Suggestions for the draft. Pass the latest analysis so only the turns it kept are sent. */
export async function runSuggestions(
  transcript: Transcript,
  settings: Settings,
  analysis?: ContextAnalysis,
  client: LLMClient = new GeminiClient({ apiKey: settings.geminiApiKey }),
): Promise<DraftSuggestions> {
  if (!settings.geminiApiKey) throw new AnalysisError("Add a Gemini API key in settings first.", true);
  try {
    return await suggestForDraft(client, transcript, {
      model: settings.analyzerModel,
      ...(analysis ? { analysis } : {}),
    });
  } catch (err) {
    throw toAnalysisError(err);
  }
}

export function toAnalysisError(err: unknown): AnalysisError {
  if (err instanceof AnalysisError) return err;
  if (err instanceof AuthError) return new AnalysisError("Google rejected your API key. Update it in settings.", true);
  if (err instanceof RateLimitError)
    return new AnalysisError("Gemini's rate limit was hit. Wait a minute and try again.");
  if (err instanceof RefusalError) return new AnalysisError("Gemini declined to analyze this conversation.");
  if (err instanceof TranscriptTooLongError) {
    return new AnalysisError("This conversation is too long to analyze in one pass yet.");
  }
  if (err instanceof AnalyzerOutputError)
    return new AnalysisError("The analyzer returned an unreadable answer. Try again.");
  if (err instanceof TypeError)
    return new AnalysisError("Could not reach Gemini. Check your connection and try again.");
  return new AnalysisError(err instanceof Error ? err.message : String(err));
}
