// The API's address and state, its documentation to download, and a place to
// try a call with a key — as a client's developer would make it.
import { useState } from "react";
import { Copy, FileCode2, FileText, Globe, Play, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionTitle } from "@/components/SectionTitle";
import { apiBaseUrl } from "@/lib/apiKeys";
import { docsFileName, docsHtml, docsOpenApi, docsPdf, saveFile } from "@/lib/apiDocs";
import { logEvent } from "@/lib/db";

export async function copyText(text: string, what = "Copied"): Promise<void> {
  try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.error("Could not copy — select it and copy by hand"); }
}

/** The docs as a web page, a PDF or an OpenAPI file — every key's own copy, or the general one. */
export async function downloadDocs(kind: "html" | "pdf" | "openapi", f: Parameters<typeof docsHtml>[0]): Promise<void> {
  const name = docsFileName(f.key);
  if (kind === "html") saveFile(`${name}.html`, docsHtml(f), "text/html");
  else if (kind === "openapi") saveFile(`${name}.openapi.json`, docsOpenApi(f), "application/json");
  else saveFile(`${name}.pdf`, await docsPdf(f));
  logEvent("export", `Downloaded the Ready Stock API docs${f.key ? ` for ${f.key.name}` : ""} (${kind === "openapi" ? "OpenAPI" : kind.toUpperCase()})`);
}

const ENDPOINTS = [
  { v: "products", label: "GET /products" },
  { v: "filters", label: "GET /filters" },
  { v: "ping", label: "GET /ping" },
  { v: "product", label: "GET /products/{id}" },
];

export function DocsPanel() {
  const base = apiBaseUrl();
  const [health, setHealth] = useState<{ ok: boolean; ms: number; at: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [key, setKey] = useState("");
  const [ep, setEp] = useState("products");
  const [params, setParams] = useState("limit=3");
  const [pid, setPid] = useState("");
  const [out, setOut] = useState<{ status: number; ms: number; headers: [string, string][]; body: string } | null>(null);
  const [running, setRunning] = useState(false);

  const check = async () => {
    setChecking(true);
    const t = performance.now();
    try {
      const r = await fetch(`${base}/health`, { cache: "no-store" });
      setHealth({ ok: r.ok, ms: Math.round(performance.now() - t), at: new Date().toLocaleTimeString() });
    } catch { setHealth({ ok: false, ms: Math.round(performance.now() - t), at: new Date().toLocaleTimeString() }); }
    finally { setChecking(false); }
  };

  const url = `${base}/${ep === "product" ? `products/${encodeURIComponent(pid.trim() || "ID")}` : ep}${params.trim() ? `?${params.trim().replace(/^\?/, "")}` : ""}`;
  const run = async () => {
    if (!key.trim()) { toast.error("Paste a key to try it with"); return; }
    setRunning(true);
    const t = performance.now();
    try {
      const r = await fetch(url, { headers: { "X-API-Key": key.trim() }, cache: "no-store" });
      const text = await r.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* as it came */ }
      const headers = [...r.headers.entries()].filter(([k]) => /^x-ratelimit|^retry-after|^x-request-id|^etag/i.test(k)) as [string, string][];
      setOut({ status: r.status, ms: Math.round(performance.now() - t), headers, body: body.length > 30_000 ? `${body.slice(0, 30_000)}\n… (cut here — ${body.length.toLocaleString("en-IN")} characters in all)` : body });
    } catch (e) {
      setOut({ status: 0, ms: Math.round(performance.now() - t), headers: [], body: `Could not reach the API: ${e instanceof Error ? e.message : e}` });
    } finally { setRunning(false); }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-luxe p-4 sm:p-5 space-y-4">
          <SectionTitle title="Address" sub="What a client's developer calls" icon={Globe} />
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2.5 min-w-0">
            <code className="text-sm break-all min-w-0 flex-1">{base}</code>
            <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 rounded-lg" onClick={() => void copyText(base, "Address copied")}><Copy className="h-3.5 w-3.5" />Copy</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" className="h-9 gap-1.5 rounded-lg" onClick={() => void check()} disabled={checking}>
              <PlugZap className="h-4 w-4" />{checking ? "Checking…" : "Check it is up"}
            </Button>
            {health && (
              <span className={`text-sm font-medium ${health.ok ? "text-success" : "text-destructive"}`}>
                {health.ok ? `● Up — answered in ${health.ms} ms` : "● Not answering"} <span className="text-xs text-muted-foreground font-normal">at {health.at}</span>
              </span>
            )}
          </div>
        </div>
        <div className="card-luxe p-4 sm:p-5 space-y-3">
          <SectionTitle title="Documentation" sub="General copy — each key's own copy is in its ⋯ menu" icon={FileText} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" className="h-auto py-3 flex-col gap-1 rounded-xl" onClick={() => void downloadDocs("pdf", { base })}><FileText className="h-5 w-5 text-primary" /><span className="text-sm">PDF</span></Button>
            <Button variant="outline" className="h-auto py-3 flex-col gap-1 rounded-xl" onClick={() => void downloadDocs("html", { base })}><Globe className="h-5 w-5 text-primary" /><span className="text-sm">Web page</span></Button>
            <Button variant="outline" className="h-auto py-3 flex-col gap-1 rounded-xl" onClick={() => void downloadDocs("openapi", { base })}><FileCode2 className="h-5 w-5 text-primary" /><span className="text-sm">OpenAPI</span></Button>
          </div>
          <p className="text-xs text-muted-foreground">OpenAPI opens in Postman, Insomnia or Swagger — every endpoint, parameter and field, ready to try.</p>
        </div>
      </div>

      <div className="card-luxe p-4 sm:p-5 space-y-4">
        <SectionTitle title="Try it" sub="A real call, with a key you paste — it counts toward that key's limits" icon={Play} />
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div>
            <Label htmlFor="try-key">API key</Label>
            <Input id="try-key" type="password" autoComplete="off" className="mt-1 rounded-xl font-mono" placeholder="rsk_live_…" value={key} onChange={e => setKey(e.target.value)} />
          </div>
          <div>
            <Label>Endpoint</Label>
            <Select value={ep} onValueChange={setEp}>
              <SelectTrigger aria-label="Endpoint" className="mt-1 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>{ENDPOINTS.map(e => <SelectItem key={e.v} value={e.v}>{e.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {ep === "product" && (
            <div className="sm:col-span-2">
              <Label htmlFor="try-id">Product id</Label>
              <Input id="try-id" className="mt-1 rounded-xl font-mono" value={pid} onChange={e => setPid(e.target.value)} placeholder="rs_…" />
            </div>
          )}
          <div className="sm:col-span-2">
            <Label htmlFor="try-q">Parameters</Label>
            <Input id="try-q" className="mt-1 rounded-xl font-mono" value={params} onChange={e => setParams(e.target.value)} placeholder="q=ring&category=Ring&sort=price_asc&limit=5" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void run()} disabled={running} className="gap-1.5"><Play className="h-4 w-4" />{running ? "Calling…" : "Send"}</Button>
          <code className="text-xs text-muted-foreground break-all min-w-0">{url}</code>
        </div>
        {out && (
          <div className="space-y-2">
            <p className="text-sm">
              <span className={`font-semibold ${out.status >= 200 && out.status < 400 ? "text-success" : "text-destructive"}`}>{out.status || "No answer"}</span>
              <span className="text-muted-foreground"> · {out.ms} ms</span>
              {out.headers.map(([k, v]) => <span key={k} className="ml-3 text-xs text-muted-foreground font-mono">{k}: {v}</span>)}
            </p>
            <pre className="max-h-[28rem] overflow-auto rounded-xl bg-slate-900 text-slate-100 text-xs p-4 font-mono whitespace-pre">{out.body}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
