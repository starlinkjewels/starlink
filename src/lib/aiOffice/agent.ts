// One AI Office question, start to answer: the server (functions aiOffice)
// passes each step to the AI; when it asks for tools, they run here on this
// admin's data (lib/aiOffice/tools.ts) and their answers go back, until it
// writes its reply. Proposed tasks are gathered on the way.
import { httpsCallable } from "firebase/functions";
import { functions } from "@/lib/firebase";
import { loadDb } from "@/lib/db";
import { brandName } from "@/lib/brand";
import { TOOL_DEFS, runTool, type ProposedAction } from "./tools";
import { proveNumbers, type Proof } from "./verify";

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
/** `proof` and `tools` are the screen's own (each answer's check and what it looked at) — the server never sees them. */
export interface ChatMessage { role: "user" | "assistant" | "tool"; content: string; tool_call_id?: string; tool_calls?: ToolCall[]; proof?: Proof; tools?: string[] }
export interface OfficeReply { text: string; actions: ProposedAction[]; messages: ChatMessage[]; tokens: number; cutOff: boolean; toolsUsed: string[]; proof: Proof }

const call = httpsCallable<
  { mode: "ask" | "brief"; messages: ChatMessage[]; tools: typeof TOOL_DEFS; language?: string; today?: string; notes?: string[]; brand?: string },
  { content: string | null; toolCalls: ToolCall[] | null; cutOff: boolean; tokens: number }
>(functions, "aiOffice", { timeout: 130_000 });

/** Rounds of tool calls before the AI must answer with what it has. */
const MAX_ROUNDS = 6;
/** A tool's answer, at most this long (the longest lists are cut, said so). */
const MAX_RESULT = 20_000;

function fit(result: unknown): string {
  const s = JSON.stringify(result);
  if (s.length <= MAX_RESULT) return s;
  return JSON.stringify({ note: "Cut to fit — ask for fewer rows or a narrower filter for the rest.", partial: s.slice(0, MAX_RESULT - 200) });
}

/**
 * Ask, and keep going until the AI answers. `history` is the conversation so
 * far (with its tool steps), the new question last. `onStep` says what is being
 * looked up, for the screen.
 */
export async function askOffice(history: ChatMessage[], opts: { mode?: "ask" | "brief"; language?: string; notes?: string[]; onStep?: (tool: string) => void } = {}): Promise<OfficeReply> {
  const messages = [...history];
  // What goes to the server: the conversation alone (the screen's checks stay here).
  const wire = () => messages.map(({ proof: _p, tools: _t, ...m }) => m);
  const turnStart = messages.length;
  const actions: ProposedAction[] = [];
  const toolsUsed: string[] = [];
  let tokens = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const last = round === MAX_ROUNDS;
    const res = (await call({ mode: opts.mode ?? "ask", messages: wire(), tools: last ? [] : TOOL_DEFS, language: opts.language, today, brand: brandName(), ...(opts.notes?.length ? { notes: opts.notes } : {}) })).data;
    tokens += res.tokens || 0;
    if (!res.toolCalls?.length || last) {
      const text = (res.content ?? "").trim() || (actions.length ? "I've put the next steps under Actions for you to approve." : "I couldn't put an answer together — try asking it another way.");
      // Every figure in it, checked against what the tools gave for this answer (the brief's figures came in before it).
      const proof = proveNumbers(text, messages.slice(opts.mode === "brief" ? 0 : turnStart).filter(m => m.role === "tool").map(m => m.content));
      messages.push({ role: "assistant", content: text, proof, tools: toolsUsed });
      return { text, actions, messages, tokens, cutOff: !!res.cutOff, toolsUsed, proof };
    }
    messages.push({ role: "assistant", content: res.content ?? "", tool_calls: res.toolCalls });
    const db = loadDb();
    for (const c of res.toolCalls) {
      opts.onStep?.(c.function.name);
      if (!toolsUsed.includes(c.function.name)) toolsUsed.push(c.function.name);
      messages.push({ role: "tool", tool_call_id: c.id, content: fit(runTool(db, c.function.name, c.function.arguments, actions)) });
    }
  }
  return { text: "", actions, messages, tokens, cutOff: false, toolsUsed, proof: { checked: 0, matched: 0, unmatched: [] } };
}

/** What a tool is doing, in words, for the "looking up…" line. */
export const STEP_WORDS: Record<string, string> = {
  business_snapshot: "the business overview", growth_signals: "today's signals", clients: "clients", client_detail: "the client",
  orders: "orders", sales_breakdown: "sales", factories: "factories", stock: "stock", money_due: "money due", team: "the team", propose_action: "next steps",
  client_pulse: "each client's rhythm", margin_guard: "gold rates against open orders",
};
