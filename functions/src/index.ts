import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { db } from "./lib/firestoreAdmin";
import { resolveCaller } from "./lib/scope";
import { buildSystemPrompt } from "./lib/systemPrompt";
import { chatCompletion, type ChatMessage, type ToolDef } from "./lib/sarvam";
import { buildToolDefs } from "./tools/schema";
import { executeTool } from "./tools/execute";

const SARVAM_API_KEY = defineSecret("SARVAM_API_KEY");

const MAX_MESSAGE_CHARS = 2000;
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_CHARS_PER_TURN = 2000;
const MAX_TOOL_ROUNDS = 3;
const DAILY_MESSAGE_CAP = 50;
// Last-resort defense in depth — the real guarantee is architectural (the
// browser never talks to the provider directly), this just cleans up the
// rare case where the model's own free text names it.
const VENDOR_NAME_FILTER = /sarvam/gi;

interface ChatRequestData {
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export const starlinkAiChat = onCall<ChatRequestData>(
  {
    secrets: [SARVAM_API_KEY],
    region: "us-central1",
    cors: true,
    enforceAppCheck: true,
    // Cost control: smallest usable memory tier (ties to the smallest CPU
    // allocation), no warm/idle instances kept running between calls (billing
    // only happens while an actual request is being handled), and capped at a
    // single instance — a small business's chat volume never needs more than
    // one instance's concurrency, and this puts a hard ceiling on cost even
    // under an abuse burst (requests queue instead of scaling out).
    memory: "256MiB",
    minInstances: 0,
    maxInstances: 1,
  },
  async request => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");

    const settingsSnap = await db.collection("meta").doc("settings").get();
    if (settingsSnap.exists && settingsSnap.get("aiEnabled") === false) {
      throw new HttpsError("failed-precondition", "Starlink AI is temporarily unavailable.");
    }

    const caller = await resolveCaller(request.auth.uid);
    await enforceDailyCap(caller.appId);

    const message = String(request.data?.message ?? "").slice(0, MAX_MESSAGE_CHARS).trim();
    if (!message) throw new HttpsError("invalid-argument", "Message is required.");

    const rawHistory = Array.isArray(request.data?.history) ? request.data.history : [];
    const history = rawHistory.slice(-MAX_HISTORY_TURNS).map(
      (h): ChatMessage => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.content ?? "").slice(0, MAX_HISTORY_CHARS_PER_TURN),
      }),
    );

    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(caller.role) },
      ...history,
      { role: "user", content: message },
    ];

    const tools = buildToolDefs(caller);
    const apiKey = SARVAM_API_KEY.value();
    let totalTokens = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callProvider(apiKey, messages, tools, "auto");
      totalTokens += result.usage?.total_tokens ?? 0;

      if (!result.toolCalls?.length) {
        await logUsage(caller, totalTokens);
        return { reply: sanitize(result.content ?? "I couldn't come up with an answer — please try rephrasing.") };
      }

      messages.push({ role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        const toolResult = await executeTool(call.function.name, call.function.arguments, caller);
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(toolResult) });
      }
    }

    // Ran out of tool-call rounds — force a final text answer with whatever we have.
    const final = await callProvider(apiKey, messages, [], "none");
    await logUsage(caller, totalTokens + (final.usage?.total_tokens ?? 0));
    return { reply: sanitize(final.content ?? "I couldn't finish that — please try a simpler question.") };
  },
);

async function callProvider(apiKey: string, messages: ChatMessage[], tools: ToolDef[], toolChoice: "auto" | "none") {
  try {
    return await chatCompletion(apiKey, messages, tools, { toolChoice, maxTokens: 500 });
  } catch (err) {
    console.error("[starlinkAiChat] provider call failed:", err);
    throw new HttpsError("internal", "Starlink AI is having trouble responding right now. Please try again.");
  }
}

function sanitize(text: string): string {
  return text.replace(VENDOR_NAME_FILTER, "Starlink AI");
}

async function enforceDailyCap(appId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const ref = db.collection("aiUsage").doc(`${appId}_${today}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const count = snap.exists ? ((snap.get("count") as number) ?? 0) : 0;
    if (count >= DAILY_MESSAGE_CAP) {
      throw new HttpsError("resource-exhausted", "You've reached today's limit for Starlink AI — please try again tomorrow.");
    }
    tx.set(ref, { count: count + 1, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

async function logUsage(caller: { appId: string; role: string }, tokensUsed: number): Promise<void> {
  try {
    await db.collection("aiUsageLogs").add({
      appId: caller.appId,
      role: caller.role,
      tokensUsed,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[starlinkAiChat] usage log failed:", err);
  }
}
