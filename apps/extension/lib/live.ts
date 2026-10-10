/**
 * Client for the Gemini Live API: one WebSocket that takes microphone audio or text and returns speech.
 * The message shapes were checked against `gemini-3.8-live` on 2026-10-10.
 * The API key is the user's own and stays on the device; it goes to Google only, in the socket address.
 */

export const LIVE_MODEL = "gemini-3.8-live";
export const LIVE_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
/** Sample rate of the audio sent to the model. */
export const INPUT_RATE = 16000;
/** Sample rate of the audio the model sends back. */
export const OUTPUT_RATE = 24000;

/** Something the model may call to get facts from Shoal. The result is sent back as JSON. */
export interface LiveTool {
  name: string;
  description: string;
  /** May be async, for tools that have to ask the chat page. */
  run: () => unknown | Promise<unknown>;
}

export type LiveEvent =
  | { kind: "ready" }
  | { kind: "audio"; pcm: Int16Array }
  | { kind: "toolCall"; calls: { id: string; name: string }[] }
  | { kind: "said"; who: "user" | "shoal"; text: string }
  | { kind: "interrupted" }
  | { kind: "turnComplete" };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The first message on the socket. It fixes the model, the voice, the instruction and the tools. */
export function setupMessage(instruction: string, tools: LiveTool[], model: string = LIVE_MODEL): object {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } } },
      },
      systemInstruction: { parts: [{ text: instruction }] },
      tools: [
        {
          functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: { type: "OBJECT", properties: {} },
          })),
        },
      ],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

export function audioMessage(pcm: Int16Array): object {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  return { realtimeInput: { audio: { data: toBase64(bytes), mimeType: `audio/pcm;rate=${INPUT_RATE}` } } };
}

export function textMessage(text: string): object {
  return { clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } };
}

export function toolResponseMessage(responses: { id: string; name: string; response: unknown }[]): object {
  return { toolResponse: { functionResponses: responses } };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/** Converts one server message into events. Unknown fields are ignored, so new ones do not break the client. */
export function parseServerMessage(value: unknown): LiveEvent[] {
  const message = record(value);
  if (!message) return [];
  const events: LiveEvent[] = [];
  if (message.setupComplete) events.push({ kind: "ready" });

  const calls = record(message.toolCall)?.functionCalls;
  if (Array.isArray(calls)) {
    const named = calls
      .map(record)
      .filter((c): c is Record<string, unknown> => c !== null && typeof c.id === "string" && typeof c.name === "string")
      .map((c) => ({ id: c.id as string, name: c.name as string }));
    if (named.length > 0) events.push({ kind: "toolCall", calls: named });
  }

  const content = record(message.serverContent);
  if (content) {
    const heard = record(content.inputTranscription)?.text;
    if (typeof heard === "string" && heard) events.push({ kind: "said", who: "user", text: heard });
    const parts = record(content.modelTurn)?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const data = record(record(part)?.inlineData)?.data;
        if (typeof data !== "string") continue;
        const bytes = fromBase64(data);
        events.push({ kind: "audio", pcm: new Int16Array(bytes.buffer, 0, Math.floor(bytes.byteLength / 2)) });
      }
    }
    const spoken = record(content.outputTranscription)?.text;
    if (typeof spoken === "string" && spoken) events.push({ kind: "said", who: "shoal", text: spoken });
    if (content.interrupted) events.push({ kind: "interrupted" });
    if (content.turnComplete) events.push({ kind: "turnComplete" });
  }
  return events;
}

export interface LiveSessionOptions {
  apiKey: string;
  instruction: string;
  tools: LiveTool[];
  onEvent: (event: LiveEvent) => void;
  /** Called once when the socket closes, with the reason when the server gave one. */
  onClose: (reason: string) => void;
}

/** One voice conversation. Tool calls are answered here; everything else is passed on as events. */
export class LiveSession {
  private socket: WebSocket | null = null;
  private ready = false;

  constructor(private readonly options: LiveSessionOptions) {}

  open(): void {
    const socket = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(this.options.apiKey)}`);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => this.send(setupMessage(this.options.instruction, this.options.tools)));
    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      for (const parsed of parseServerMessage(JSON.parse(text))) {
        if (parsed.kind === "ready") this.ready = true;
        if (parsed.kind === "toolCall") void this.answer(parsed.calls);
        this.options.onEvent(parsed);
      }
    });
    socket.addEventListener("close", (event) => {
      this.ready = false;
      this.options.onClose(event.reason || (event.code === 1000 ? "" : `connection closed (${event.code})`));
    });
  }

  /** Audio is dropped until the server has accepted the setup. */
  sendAudio(pcm: Int16Array): void {
    if (this.ready) this.send(audioMessage(pcm));
  }

  sendText(text: string): void {
    if (this.ready) this.send(textMessage(text));
  }

  close(): void {
    this.socket?.close(1000);
    this.socket = null;
    this.ready = false;
  }

  private async answer(calls: { id: string; name: string }[]): Promise<void> {
    const responses = await Promise.all(
      calls.map(async (call) => {
        const tool = this.options.tools.find((t) => t.name === call.name);
        if (!tool) return { ...call, response: { error: `unknown tool ${call.name}` } };
        try {
          return { ...call, response: { result: await tool.run() } };
        } catch (err) {
          return { ...call, response: { error: err instanceof Error ? err.message : String(err) } };
        }
      }),
    );
    this.send(toolResponseMessage(responses));
  }

  private send(message: object): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
