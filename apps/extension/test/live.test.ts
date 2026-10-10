import { describe, expect, it } from "vitest";
import {
  audioMessage,
  fromBase64,
  parseServerMessage,
  setupMessage,
  textMessage,
  toBase64,
  toolResponseMessage,
} from "../lib/live";

describe("base64 helpers", () => {
  it("round-trip bytes, including blocks larger than one call-stack chunk", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("client messages", () => {
  it("builds the setup with the model, the audio reply, the instruction and the tools", () => {
    const message = setupMessage("Be brief.", [{ name: "get_x", description: "Returns x.", run: () => 1 }]) as {
      setup: Record<string, unknown>;
    };
    expect(message.setup.model).toBe("models/gemini-3.8-live");
    expect(message.setup.generationConfig).toMatchObject({ responseModalities: ["AUDIO"] });
    expect(message.setup.systemInstruction).toEqual({ parts: [{ text: "Be brief." }] });
    expect(message.setup.tools).toEqual([
      {
        functionDeclarations: [
          { name: "get_x", description: "Returns x.", parameters: { type: "OBJECT", properties: {} } },
        ],
      },
    ]);
    expect(message.setup).toHaveProperty("inputAudioTranscription");
    expect(message.setup).toHaveProperty("outputAudioTranscription");
  });

  it("sends microphone audio as 16 kHz PCM", () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768]);
    const message = audioMessage(pcm) as { realtimeInput: { audio: { data: string; mimeType: string } } };
    expect(message.realtimeInput.audio.mimeType).toBe("audio/pcm;rate=16000");
    const bytes = fromBase64(message.realtimeInput.audio.data);
    expect(new Int16Array(bytes.buffer)).toEqual(pcm);
  });

  it("sends typed text as a complete user turn", () => {
    expect(textMessage("hi")).toEqual({
      clientContent: { turns: [{ role: "user", parts: [{ text: "hi" }] }], turnComplete: true },
    });
  });

  it("answers tool calls by id", () => {
    expect(toolResponseMessage([{ id: "call_1", name: "get_x", response: { result: 1 } }])).toEqual({
      toolResponse: { functionResponses: [{ id: "call_1", name: "get_x", response: { result: 1 } }] },
    });
  });
});

describe("parseServerMessage", () => {
  it("reads the messages of a real session", () => {
    expect(parseServerMessage({ setupComplete: {} })).toEqual([{ kind: "ready" }]);
    expect(
      parseServerMessage({
        toolCall: { functionCalls: [{ name: "get_model_recommendation", args: {}, id: "call_55053" }] },
      }),
    ).toEqual([{ kind: "toolCall", calls: [{ id: "call_55053", name: "get_model_recommendation" }] }]);
    expect(parseServerMessage({ serverContent: { outputTranscription: { text: "A smaller model" } } })).toEqual([
      { kind: "said", who: "shoal", text: "A smaller model" },
    ]);
    expect(parseServerMessage({ serverContent: { inputTranscription: { text: "which model" } } })).toEqual([
      { kind: "said", who: "user", text: "which model" },
    ]);
    expect(parseServerMessage({ serverContent: { generationComplete: true } })).toEqual([]);
    expect(
      parseServerMessage({ serverContent: { turnComplete: true }, usageMetadata: { totalTokenCount: 628 } }),
    ).toEqual([{ kind: "turnComplete" }]);
    expect(parseServerMessage({ serverContent: { interrupted: true } })).toEqual([{ kind: "interrupted" }]);
  });

  it("decodes speech as 16-bit samples", () => {
    const pcm = new Int16Array([100, -200, 300]);
    const data = toBase64(new Uint8Array(pcm.buffer));
    const events = parseServerMessage({
      serverContent: { modelTurn: { parts: [{ inlineData: { data, mimeType: "audio/pcm;rate=24000" } }] } },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "audio" });
    expect(Array.from((events[0] as { pcm: Int16Array }).pcm)).toEqual([100, -200, 300]);
  });

  it("ignores what it does not know", () => {
    expect(parseServerMessage(null)).toEqual([]);
    expect(parseServerMessage({ sessionResumptionUpdate: {} })).toEqual([]);
    expect(parseServerMessage({ toolCall: { functionCalls: [{ name: "no id" }] } })).toEqual([]);
    expect(parseServerMessage({ serverContent: { modelTurn: { parts: [{ text: "thought" }] } } })).toEqual([]);
  });
});
