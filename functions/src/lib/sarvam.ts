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
  usage?: { total_tokens?: number };
}

export async function chatCompletion(
  apiKey: string,
  messages: ChatMessage[],
  tools: ToolDef[],
  opts: { toolChoice?: "auto" | "none"; maxTokens?: number } = {},
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
      reasoning_effort: null,
    }),
  });

  if (!res.ok) {
    // Never forward the raw response body upstream — it could contain
    // vendor-identifying text (error messages, model name, etc.).
    throw new Error(`chat provider request failed with status ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>;
    usage?: { total_tokens?: number };
  };
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? null,
    usage: data.usage,
  };
}
