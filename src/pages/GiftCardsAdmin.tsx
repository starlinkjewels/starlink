import { DataTable } from "@/components/DataTable";
import { useState } from "react";
import { useDb } from "@/hooks/useDb";
import { fmtMoney, fmtDate, giftCardStats, giftCardRemaining, giftCardStatus, type GiftCard, type GiftCardStatus } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePagination } from "@/hooks/usePagination";
import { PaginationBar } from "@/components/PaginationBar";
import { ExportDialog } from "@/components/ExportDialog";
import { downloadLedgerPdf, downloadCsv } from "@/lib/ledgerExport";
import { Gift, CheckCircle2, Clock, AlertCircle, Search, Download } from "lucide-react";

const STATUS_STYLE: Record<GiftCardStatus, string> = {
  active: "bg-success/10 text-success",
  used: "bg-secondary text-muted-foreground",
  expired: "bg-amber-500/10 text-amber-700",
  cancelled: "bg-destructive/10 text-destructive",
};

export function GiftCardsAdminPage() {
  const db = useDb();
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | GiftCardStatus>("all");
  const [showExport, setShowExport] = useState(false);

  const clientName = (id: string) => db.clients.find(c => c.id === id)?.companyName ?? "—";
  const sourceLabel = (s: GiftCard["source"] | string) => (s === "cashback" ? "Cashback" : "Gift");
  const ordersFor = (cardId: string) => db.orders.filter(o => o.giftCardId === cardId && (o.giftCardRedeemed || 0) > 0);

  const all = (db.giftCards ?? []).slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const stats = giftCardStats(all, db.orders); // all-time, reconciles: issued = used + pending + expired

  const ql = q.trim().toLowerCase();
  const rows = all.filter(c => {
    if (statusFilter !== "all" && giftCardStatus(c, db.orders) !== statusFilter) return false;
    if (ql && !clientName(c.clientId).toLowerCase().includes(ql)) return false;
    return true;
  });

  const PAGE = 15;
  const { paged, page, setPage, totalPages, total, start, end } = usePagination(rows, PAGE);

  // ── Exports (date range on issue date) ──
  const inRange = (iso: string, from: Date | null, to: Date | null) => {
    const t = +new Date(iso);
    if (from && t < +new Date(from.getFullYear(), from.getMonth(), from.getDate())) return false;
    if (to && t > +new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59)) return false;
    return true;
  };
  const exportRowsFor = (from: Date | null, to: Date | null) =>
    rows.filter(c => inRange(c.createdAt, from, to));
  const money0 = (n: number) => Math.round(n).toLocaleString("en-US");

  const exportPdf = (from: Date | null, to: Date | null) => {
    const rs = exportRowsFor(from, to);
    const s = giftCardStats(rs, db.orders);
    downloadLedgerPdf({
      title: "Gift Cards — Tracking Report",
      subjectLines: [
        from || to ? `Period: ${from ? fmtDate(from.toISOString()) : "start"} - ${to ? fmtDate(to.toISOString()) : "today"}` : "Period: all time",
        `Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      ],
      summary: [
        { label: "Issued", value: "$" + money0(s.issued) },
        { label: "Redeemed", value: "$" + money0(s.used) },
        { label: "Pending", value: "$" + money0(s.pending) },
        { label: "Expired/Cancelled", value: "$" + money0(s.expired) },
      ],
      landscape: true,
      columns: [
        { header: "Client", x: 14 }, { header: "Source", x: 66 }, { header: "Amount", x: 96 },
        { header: "Used", x: 120 }, { header: "Remaining", x: 148 }, { header: "Status", x: 170 },
        { header: "Issued", x: 198 }, { header: "Expires", x: 226 }, { header: "Orders", x: 254 },
      ],
      align: ["left", "left", "right", "right", "right", "left", "left", "left", "left"],
      rows: rs.map(c => {
        const rem = giftCardRemaining(c, db.orders);
        return [
          clientName(c.clientId).slice(0, 26), sourceLabel(c.source), "$" + money0(c.amount), "$" + money0(c.amount - rem),
          "$" + money0(rem), giftCardStatus(c, db.orders), fmtDate(c.createdAt), fmtDate(c.expiresAt),
          ordersFor(c.id).map(o => o.orderNumber).join(", ").slice(0, 22),
        ];
      }),
      totalsRow: ["Totals", "", "$" + money0(s.issued), "$" + money0(s.used), "$" + money0(s.pending + s.expired), "", "", "", ""],
      filename: "Gift-Cards-Tracking",
    });
  };
  const exportCsv = (from: Date | null, to: Date | null) => {
    const rs = exportRowsFor(from, to);
    downloadCsv("Gift-Cards-Tracking",
      ["Client", "Source", "Amount (USD)", "Used (USD)", "Remaining (USD)", "Status", "Issued", "Expires", "Orders redeemed", "Note"],
      rs.map(c => {
        const rem = giftCardRemaining(c, db.orders);
        return [clientName(c.clientId), sourceLabel(c.source), Math.round(c.amount), Math.round(c.amount - rem), Math.round(rem),
          giftCardStatus(c, db.orders), fmtDate(c.createdAt), fmtDate(c.expiresAt),
          ordersFor(c.id).map(o => o.orderNumber).join(" "), c.note ?? ""];
      }),
    );
  };

  const TILES: [string, string, typeof Gift, string][] = [
    ["Issued", fmtMoney(stats.issued), Gift, "text-primary"],
    ["Redeemed", fmtMoney(stats.used), CheckCircle2, "text-success"],
    ["Pending", fmtMoney(stats.pending), Clock, "text-warning-foreground"],
    ["Expired / Cancelled", fmtMoney(stats.expired), AlertCircle, "text-muted-foreground"],
  ];

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl text-brand-dark flex items-center gap-2"><Gift className="h-6 w-6 text-primary" /> Gift Cards</h1>
          <p className="text-sm text-muted-foreground">Every card issued, redeemed, pending and expired — {stats.count} card{stats.count !== 1 ? "s" : ""}</p>
        </div>
        <Button variant="outline" onClick={() => setShowExport(true)} className="rounded-xl gap-2"><Download className="h-4 w-4" /> Export</Button>
      </div>

      {/* Summary — Issued = Redeemed + Pending + Expired */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TILES.map(([label, val, Icon, color]) => (
          <div key={label} className="card-luxe p-4">
            <div className="h-8 w-8 rounded-lg bg-secondary grid place-items-center mb-3"><Icon className={`h-4 w-4 ${color}`} /></div>
            <p className="text-lg font-display font-bold text-brand-dark truncate">{val}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="card-luxe overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px] sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search client…" className="pl-9 h-9 rounded-xl text-sm" />
          </div>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v as "all" | GiftCardStatus)}>
            <SelectTrigger className="h-9 w-[150px] rounded-xl"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="used">Used</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="p-4">
          <DataTable
            id="gift-cards"
            rows={rows}
            rowKey={c => c.id}
            defaultSort={{ key: "issued", dir: "desc" }}
            emptyText={ql || statusFilter !== "all" ? "No gift cards match your filters." : "No gift cards issued yet."}
            columns={[
              { key: "client", header: "Client", always: true, sortValue: c => clientName(c.clientId), cell: c => <span className="font-medium max-w-[180px] truncate block">{clientName(c.clientId)}</span> },
              { key: "source", header: "Source", sortValue: c => sourceLabel(c.source), cell: c => <span className="text-xs text-muted-foreground">{sourceLabel(c.source)}</span> },
              { key: "amount", header: "Amount", align: "right", sortValue: c => c.amount, cell: c => <span className="font-semibold tabular-nums">{fmtMoney(c.amount)}</span> },
              { key: "used", header: "Used", align: "right", sortValue: c => c.amount - giftCardRemaining(c, db.orders), cell: c => <span className="tabular-nums text-success">{fmtMoney(c.amount - giftCardRemaining(c, db.orders))}</span> },
              { key: "remaining", header: "Remaining", align: "right", sortValue: c => giftCardRemaining(c, db.orders), cell: c => <span className="tabular-nums">{fmtMoney(giftCardRemaining(c, db.orders))}</span> },
              { key: "status", header: "Status", align: "center", sortValue: c => giftCardStatus(c, db.orders), cell: c => { const st = giftCardStatus(c, db.orders); return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[st]}`}>{st}</span>; } },
              { key: "issued", header: "Issued", kind: "date", sortValue: c => c.createdAt, cell: c => <span className="text-xs text-muted-foreground">{fmtDate(c.createdAt)}</span> },
              { key: "expires", header: "Expires", kind: "date", sortValue: c => c.expiresAt, cell: c => <span className="text-xs text-muted-foreground">{fmtDate(c.expiresAt)}</span> },
              { key: "orders", header: "Orders", sortValue: c => ordersFor(c.id).map(o => o.orderNumber).join(", "), cell: c => <span className="text-xs font-mono text-muted-foreground max-w-[160px] truncate block">{ordersFor(c.id).map(o => o.orderNumber).join(", ") || "—"}</span> },
            ]}
          />
        </div>
      </div>

      <ExportDialog open={showExport} onClose={() => setShowExport(false)} title="Gift Cards Report"
        options={[
          { label: "Gift Cards — PDF", sublabel: "Full tracking report (landscape)", kind: "pdf", run: exportPdf },
          { label: "Gift Cards — Excel", sublabel: "All columns + notes", kind: "excel", run: exportCsv },
        ]} />
    </div>
  );
}
