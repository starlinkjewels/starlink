// The ONLY file in this codebase allowed to reference the AI provider by name,
// its endpoint, or its model names. Everything else calls the generic
// `chatCompletion()` below and never sees any of that — this is a deliberate
// chokepoint so the vendor can never leak into a log, error, or response that
// reaches the frontend.

const CHAT_COMPLETIONS_URL = "https://api.sarvam.ai/v1/chat/completions";
const MODEL = "sarvam-105b";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatCompletionResult {
  content: string | null;
  toolCalls: ToolCall[] | null;
  usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  /** "length": cut off at maxTokens (the answer is unfinished). */
  finishReason?: string;
}

export async function chatCompletion(
  apiKey: string,
  messages: ChatMessage[],
  tools: ToolDef[],
  opts: {
    toolChoice?: "auto" | "none"; maxTokens?: number;
    /** Think before answering (analysis, a day's brief): its thinking counts against maxTokens. Unset: off, as for lookups. */
    reasoning?: "low" | "medium" | "high";
  } = {},
): Promise<ChatCompletionResult> {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(tools.length
        ? { tools, tool_choice: opts.toolChoice ?? "auto" }
        : {}),
      max_tokens: opts.maxTokens ?? 700,
      temperature: 0.2,
      // Explicitly disabled — reasoning/thinking tokens are billed against the
      // same max_tokens budget as the visible answer, so leaving this unset
      // (provider default may enable reasoning) can silently eat most of the
      // budget before the model writes anything visible, truncating the
      // actual reply. This assistant only does straightforward lookups/
      // formatting, not the kind of task reasoning mode is meant for.
      // (The AI Office asks for it on analysis, with a budget to match.)
      reasoning_effort: opts.reasoning ?? null,
    }),
  });

  if (!res.ok) {
    // Never forward the raw response body upstream — it could contain
    // vendor-identifying text (error messages, model name, etc.).
    throw new Error(`chat provider request failed with status ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>;
    usage?: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? null,
    usage: data.usage,
    finishReason: choice?.finish_reason,
  };
}

// ── Speech: what was said (any Indian language or English, found by itself),
// and a reply spoken in a natural voice. Same chokepoint: nothing outside this
// file knows whose service it is.
const SPEECH_TO_TEXT_URL = "https://api.sarvam.ai/speech-to-text";
const TEXT_TO_SPEECH_URL = "https://api.sarvam.ai/text-to-speech";

export async function speechToText(apiKey: string, audio: Buffer, mime: string): Promise<{ text: string; language: string | null }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), mime.includes("mp4") ? "speech.m4a" : mime.includes("ogg") ? "speech.ogg" : "speech.webm");
  form.append("model", "saaras:v4");
  form.append("language_code", "unknown");
  const res = await fetch(SPEECH_TO_TEXT_URL, { method: "POST", headers: { "api-subscription-key": apiKey }, body: form });
  if (!res.ok) throw new Error(`speech provider request failed with status ${res.status}`);
  const data = (await res.json()) as { transcript?: string; language_code?: string | null };
  return { text: String(data.transcript ?? "").trim(), language: data.language_code ?? null };
}

/** A reply spoken (mp3, base64). `language`: "gu-IN", "hi-IN", "en-IN" …; `voice`: one of the natural voices. */
export async function textToSpeech(apiKey: string, text: string, language: string, voice: string, pace = 1): Promise<string> {
  const res = await fetch(TEXT_TO_SPEECH_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "api-subscription-key": apiKey },
    body: JSON.stringify({ text: text.slice(0, 2500), language_code: language, model: "bulbul:v3", speaker: voice, pace, speech_sample_rate: 24000, output_audio_codec: "mp3" }),
  });
  if (!res.ok) throw new Error(`speech provider request failed with status ${res.status}`);
  const data = (await res.json()) as { audios?: string[] };
  return data.audios?.[0] ?? "";
}
