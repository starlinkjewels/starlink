import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, uid, buildTimelineSteps, buildReadyStockTimelineSteps, buildReadyStockSaleTimelineSteps, allocatePaymentFIFO, activeGiftCardsFor, giftCardBalanceFor, giftCardRemaining, giftMaxRedeemPctFor, type Order } from "@/lib/db";
import { sendMail, orderReceivedEmail, MARKETING_EMAIL } from "@/lib/email";
import { useDb } from "@/hooks/useDb";
import { uploadDataUrl } from "@/lib/storage";
import { subscribeStockLevels, type StockLevels } from "@/lib/stock";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { DollarSign, Building2, ImagePlus, X, Gem, Clock, Sparkles, Truck, CreditCard, AlertCircle, BadgeCheck, Boxes, ShoppingBag, HelpCircle, PackageCheck, Gift, ArrowLeft, Factory as FactoryIconLucide } from "lucide-react";

const READY_STOCK_NONE = "none";

/** Compress a File to a base64 JPEG ≤800px, quality 0.75 */
async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > MAX || h > MAX) {
          if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
          else       { w = Math.round(w * MAX / h); h = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function NewOrderPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const db = useDb();
  const isAdmin    = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const isClient   = user?.role === "client";
  const READY_STOCK_CLIENT = "__readystock__"; // sentinel in the client dropdown = build for inventory, no client

  const initDb          = loadDb();
  const allClients      = isAdmin
    ? initDb.clients.filter(c => c.status === "active")
    : isEmployee
    ? initDb.clients.filter(c => c.status === "active" && c.accountManagerId === user!.id)
    : [];
  const diamondRate     = initDb.settings.diamondRate             ?? 3500;
  const metalRate       = initDb.settings.metalRate               ?? 65;
  const defaultShipping = initDb.settings.defaultShippingCharge  ?? 0;

  const [f, setF] = useState({
    clientId: isClient ? (user!.clientId ?? "") : "",
    jewelleryType: "Ring",
    metal: "Gold",
    diamondType: "Natural",
    quantity: 1,
    diamondWeight: 0.5,
    estimatedGrossWeight: 0,
    estimatedNetWeight: 0,
    instructions: "",
    expectedDelivery: "",
    priority: "Normal",
    designNumber: "",
    productSize: "",
    productColor: "",
    productKarats: "",
    deliveryTime: "",
    rhodium: "",
    stamping: "",
    stampingNote: "",
    orderValue: 0,
    shippingCharge: defaultShipping,
    advanceAmount: 0,
    advanceNote: "",
    advanceLockerId: "",
    advanceLockerAmount: "",
    certificate: "no" as "yes" | "no",
    certificateFee: 50,
    materialSourcing: "later" as "later" | "stock" | "purchase" | "readyStock",
    readyStockItemId: "",
    assignedFactoryId: "",
  });

  const [images, setImages] = useState<string[]>([]);
  const imgRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const [stockLevels, setStockLevels] = useState<StockLevels | null>(null);
  useEffect(() => subscribeStockLevels(setStockLevels), []);
  const availableGold = f.productKarats ? (stockLevels?.gold[f.productKarats] ?? 0) : null;
  const goldShort = availableGold !== null && Number(f.estimatedNetWeight) > availableGold;

  const handleImageFiles = async (files: FileList | null) => {
    if (!files) return;
    const remaining = 3 - images.length;
    if (remaining <= 0) { toast.error("Maximum 3 images allowed"); return; }
    const toProcess = Array.from(files).slice(0, remaining);
    try {
      const compressed = await Promise.all(toProcess.map(compressImage));
      setImages(prev => [...prev, ...compressed].slice(0, 3));
    } catch { toast.error("Failed to process image"); }
  };

  const removeImage = (idx: number) =>
    setImages(prev => prev.filter((_, i) => i !== idx));

  const set = (key: string, value: unknown) =>
    setF(prev => ({ ...prev, [key]: value }));

  const metalHasKarats = !["Silver", "Platinum", "None (Diamond only)"].includes(f.metal);
  // A pure diamond sale, no jewellery piece at all — hides every field that
  // only makes sense for a manufactured piece (size, plating, factory, etc.).
  const isDiamondOnly = f.jewelleryType === "Diamond Only";
  // In-house order to build a piece for Ready Stock — no client, no billing, short timeline.
  const forReadyStock = !isClient && f.clientId === READY_STOCK_CLIENT;
  // Selling an EXISTING finished piece — specs come from the item, so the custom
  // design/production fields and the manufacturing timeline don't apply.
  const isReadyStockSale = f.materialSourcing === "readyStock";
  const [redeemGift, setRedeemGift] = useState(true); // apply the client's gift card to this order

  const setMetal = (v: string) => {
    setF(prev => ({
      ...prev,
      metal: v,
      productKarats: ["Silver", "Platinum", "None (Diamond only)"].includes(v) ? "" : prev.productKarats,
    }));
  };

  const setJewelleryType = (v: string) => {
    setF(prev => ({
      ...prev,
      jewelleryType: v,
      metal: v === "Diamond Only" ? "None (Diamond only)" : prev.metal,
      productKarats: v === "Diamond Only" ? "" : prev.productKarats,
    }));
  };

  const applyEstimate = () => {
    // Must match the displayed estimate (metal + diamond), not diamond alone —
    // otherwise the button silently under-prices the order by the metal value.
    const auto = Math.round(Number(f.estimatedNetWeight) * metalRate + Number(f.diamondWeight) * diamondRate);
    setF(prev => ({ ...prev, orderValue: auto }));
  };

  // ── Sell from Ready Stock (optional) — picking a finished piece auto-fills
  // the specs/price below instead of the client/staff typing a custom order.
  const readyStockItems = db.readyStock.filter(i => i.quantity > 0).sort((a, b) => a.name.localeCompare(b.name));
  const selectedStockItem = db.readyStock.find(i => i.id === f.readyStockItemId);

  const selectReadyStock = (itemId: string) => {
    if (!itemId) { setF(prev => ({ ...prev, readyStockItemId: "", materialSourcing: "later" })); return; }
    const item = db.readyStock.find(i => i.id === itemId);
    if (!item) return;
    const colorGuess = item.metal === "Rose Gold" ? "Rose" : item.metal === "White Gold" ? "White" : "Yellow";
    setF(prev => ({
      ...prev,
      readyStockItemId: itemId,
      materialSourcing: "readyStock",
      jewelleryType: item.jewelleryType,
      metal: item.metal,
      productKarats: item.productKarats || "",
      productColor: prev.productColor || colorGuess,
      diamondType: item.diamondType || prev.diamondType,
      diamondWeight: item.diamondWeight || 0,
      estimatedGrossWeight: item.grossWeight || 0,
      estimatedNetWeight: item.netWeight || 0,
      orderValue: item.price,
      designNumber: item.sku || prev.designNumber,
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isClient && !isAdmin && !isEmployee) { toast.error("You don't have permission to create orders."); return; }
    if ((isAdmin || isEmployee) && !f.clientId) { toast.error("Please select a client for this order."); return; }
    if (!isClient && !forReadyStock && f.orderValue <= 0) { toast.error("Please enter a valid order value."); return; }
    // A Ready-Stock sale reuses the finished piece's specs — don't re-ask for them.
    const needSpecs = !isDiamondOnly && !isReadyStockSale;
    if (needSpecs && !f.designNumber.trim()) { toast.error("Design Number is required."); return; }
    if (needSpecs && !f.productSize.trim())  { toast.error("Product Size is required."); return; }
    if (needSpecs && !f.productColor)        { toast.error("Color of Product is required."); return; }
    if (needSpecs && metalHasKarats && !f.productKarats) { toast.error("Karats of Product is required."); return; }
    if (needSpecs && !f.rhodium)             { toast.error("Please select a Rhodium option."); return; }
    if (needSpecs && !f.stamping)            { toast.error("Please select a Stamping option."); return; }
    if (needSpecs && f.stamping === "Special Stamp" && !f.stampingNote.trim()) { toast.error("Please describe the special stamp."); return; }
    if (!f.quantity || Number(f.quantity) < 1) { toast.error("Quantity must be at least 1."); return; }
    if (f.materialSourcing === "readyStock") {
      const item = db.readyStock.find(i => i.id === f.readyStockItemId);
      if (!item || item.quantity <= 0) { toast.error("This ready stock item is no longer available — pick another, or switch to a custom order."); return; }
    }
    if (Number(f.advanceAmount) > 0) {
      if (!f.advanceLockerId) { toast.error("Choose which locker the advance was deposited into."); return; }
      if (!f.advanceLockerAmount || Number(f.advanceLockerAmount) <= 0) { toast.error("Enter the amount actually deposited in that locker."); return; }
    }

    setSaving(true);
    const clientId = isClient ? user!.clientId! : (forReadyStock ? "" : f.clientId);
    const orderId = uid("o_");

    // Upload reference images to Firebase Storage; store their URLs on the order.
    let imageUrls: string[] = [];
    try {
      imageUrls = await Promise.all(images.map(img => uploadDataUrl(img, `orders/${orderId}`)));
    } catch {
      toast.error("Failed to upload images. Please try again.");
      setSaving(false);
      return;
    }

    // Captured inside updateDb so we can email marketing AFTER the write.
    let mailInfo: { orderNumber: string; clientName: string; jewelleryType?: string; metal?: string; quantity?: number; expectedDelivery?: string } | null = null;

    updateDb(d => {
      const num = `SLJ-${new Date().getFullYear()}-${String(1000 + d.orders.length + 1).padStart(4, "0")}`;
      const advance = Number(f.advanceAmount) || 0;

      // Assign the order to an employee so it shows in their views: the creating
      // employee, otherwise the client's account manager (if any).
      const managerId = d.clients.find(c => c.id === clientId)?.accountManagerId;
      const assignedEmployeeId = isEmployee ? user!.id : managerId;

      const order: Order = {
        id: orderId,
        orderNumber: num,
        clientId,
        forReadyStock: forReadyStock || undefined,
        assignedEmployeeId,
        contactPerson: user!.name,
        jewelleryType: f.jewelleryType as Order["jewelleryType"],
        metal: f.metal as Order["metal"],
        diamondType: f.diamondType as Order["diamondType"],
        quantity: Number(f.quantity),
        diamondWeight: Number(f.diamondWeight),
        metalWeight: 0,
        estimatedGrossWeight: Number(f.estimatedGrossWeight) || undefined,
        estimatedNetWeight: Number(f.estimatedNetWeight) || undefined,
        images: imageUrls,
        designNumber: f.designNumber || undefined,
        productSize: f.productSize || undefined,
        productColor: f.productColor || undefined,
        productKarats: f.productKarats || undefined,
        deliveryTime: f.deliveryTime || undefined,
        rhodium: f.rhodium || undefined,
        stamping: f.stamping === "Special Stamp" && f.stampingNote.trim() ? `Special Stamp: ${f.stampingNote.trim()}` : (f.stamping || undefined),
        certificate: f.certificate === "yes",
        certificateFee: f.certificate === "yes" ? (Number(f.certificateFee) || 0) : 0,
        materialSourcing: f.materialSourcing === "later" ? undefined : f.materialSourcing,
        readyStockItemId: f.materialSourcing === "readyStock" ? f.readyStockItemId : undefined,
        assignedFactoryId: f.assignedFactoryId || undefined,
        instructions: f.instructions,
        expectedDelivery: f.expectedDelivery || new Date(Date.now() + 45 * 86400000).toISOString(),
        priority: f.priority as Order["priority"],
        status: forReadyStock ? "In Production" : isReadyStockSale ? "Ready" : "Waiting",
        amount: forReadyStock ? 0 : f.orderValue,
        giftCardId: willRedeem ? giftCard!.id : undefined,
        giftCardRedeemed: willRedeem ? giftMax : undefined,
        shippingCharge: Number(f.shippingCharge) || 0,
        advances: advance > 0 ? [{
          id: uid("adv_"),
          amount: advance,
          note: f.advanceNote || "Initial advance",
          recordedBy: user!.id,
          createdAt: new Date().toISOString(),
          lockerId: f.advanceLockerId || undefined,
          lockerAmount: f.advanceLockerId ? Number(f.advanceLockerAmount) : undefined,
        }] : [],
        timeline: (forReadyStock ? buildReadyStockTimelineSteps() : isReadyStockSale ? buildReadyStockSaleTimelineSteps() : buildTimelineSteps(f.certificate === "yes")).map((s, i) => ({
          step: s,
          status: i === 0 ? "done" : "pending" as "done" | "pending",
          date: i === 0 ? new Date().toISOString() : undefined,
        })),
        createdAt: new Date().toISOString(),
      };

      d.orders.unshift(order);
      // Invoices are no longer auto-created per order — they're generated at
      // dispatch time by selecting orders on the Invoices page.
      // In-house Ready-Stock builds have no client, so skip the marketing notice.
      if (!forReadyStock) mailInfo = {
        orderNumber: order.orderNumber,
        clientName: d.clients.find(c => c.id === clientId)?.companyName ?? "Client",
        jewelleryType: order.jewelleryType,
        metal: order.metal,
        quantity: order.quantity,
        expectedDelivery: order.expectedDelivery,
      };

      if (order.materialSourcing === "readyStock" && order.readyStockItemId) {
        const item = d.readyStock.find(x => x.id === order.readyStockItemId);
        if (item) item.quantity = Math.max(0, item.quantity - 1);
      }

      if (order.assignedFactoryId) {
        const assignedFactory = d.factories.find(fac => fac.id === order.assignedFactoryId);
        if (!order.manufacturingLog) order.manufacturingLog = [];
        order.manufacturingLog.push({
          id: uid("mlog_"), type: "factory_assigned", at: order.createdAt, employeeId: user!.id, factoryId: order.assignedFactoryId,
          remarks: `Factory assigned: ${assignedFactory?.name || "factory"}`,
        });
      }

      if (advance > 0 && f.advanceLockerId) {
        const locker = d.lockers.find(l => l.id === f.advanceLockerId);
        if (locker) {
          if (!d.lockerTransactions) d.lockerTransactions = [];
          d.lockerTransactions.push({
            id: uid("ltx_"), lockerId: f.advanceLockerId, type: "income", amountInr: Number(f.advanceLockerAmount),
            currency: locker.currency || "INR", category: `Client Payment — ${order.orderNumber}`,
            refType: "clientPayment", refId: order.id, recordedBy: user!.id, createdAt: new Date().toISOString(),
          });
        }
      }

      if (isClient) {
        const admin = d.users.find(u => u.role === "admin");
        if (admin) d.notifications.unshift({
          id: uid("n_"), userId: admin.id,
          title: "New Order Request",
          body: `${order.orderNumber} from ${d.clients.find(c => c.id === clientId)?.companyName ?? "client"}${advance > 0 ? ` · Advance $${advance}` : ""}`,
          type: "order", read: false, createdAt: new Date().toISOString(),
        });
      }

      if ((isAdmin || isEmployee) && !forReadyStock) {
        const clientUser = d.users.find(u => u.clientId === clientId && u.role === "client");
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id,
          title: "Order Created",
          body: `${order.orderNumber} has been created for your account.`,
          type: "order", read: false, createdAt: new Date().toISOString(),
        });

        // Auto-apply any carried-forward client credit to the oldest bills first.
        // Only staff sessions may write the client record, so scope this to them.
        const c = d.clients.find(cl => cl.id === clientId);
        if (c && (c.creditBalance || 0) > 0) {
          const clientOrders = d.orders.filter(o => o.clientId === clientId);
          const leftover = allocatePaymentFIFO(clientOrders, c.creditBalance || 0, user!.id, new Date().toISOString());
          c.creditBalance = leftover > 0 ? leftover : undefined;
        }
      }
    });

    // Notify the marketing inbox that a new order came in (fire-and-forget).
    if (mailInfo) {
      const m = orderReceivedEmail(mailInfo);
      void sendMail(MARKETING_EMAIL, m.subject, m.html);
    }

    toast.success("Order submitted successfully");
    nav("/orders");
  };

  const shipping   = Number(f.shippingCharge) || 0;
  const certFee    = f.certificate === "yes" ? (Number(f.certificateFee) || 0) : 0;
  const grandTotal = Number(f.orderValue) + shipping + certFee;
  const balanceDue = Math.max(0, grandTotal - Number(f.advanceAmount));
  const autoValue  = Math.round(Number(f.estimatedNetWeight) * metalRate + Number(f.diamondWeight) * diamondRate);

  // ── Gift card on this new order ──
  const giftClientId = forReadyStock ? "" : (isClient ? (user?.clientId ?? "") : f.clientId);
  const giftCards    = giftClientId ? activeGiftCardsFor(db, giftClientId) : [];
  const giftCard     = giftCards[0];
  const giftBalance  = giftClientId ? giftCardBalanceFor(db, giftClientId) : 0;
  const giftRemaining = giftCard ? giftCardRemaining(giftCard, db.orders) : 0;
  const giftPct = giftMaxRedeemPctFor(db, giftClientId ? db.clients.find(c => c.id === giftClientId) : undefined);
  // Applies only once the order has a value (staff price / ready-stock sale). Clients'
  // custom orders are priced later, so it's applied on the order then.
  const giftMax = giftCard && grandTotal > 0
    ? Math.round(Math.max(0, Math.min(giftRemaining, grandTotal * giftPct, grandTotal)) * 100) / 100
    : 0;
  const willRedeem = redeemGift && !!giftCard && giftMax > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <button onClick={() => nav(-1)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <div className="pb-1">
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">New Order</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isClient ? "Submit a new jewellery order request" : "Create an order on behalf of a client"}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">

        {/* ══ 1. Client selector (admin / employee only) ══ */}
        {(isAdmin || isEmployee) && (
          <SectionCard icon={<Building2 className="h-4 w-4 text-primary" />} title="Client" subtitle="Select the client — or build a piece for your own Ready Stock">
            <Field label="Select Client *">
              <Select value={f.clientId} onValueChange={v => set("clientId", v)} required>
                <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Choose a client…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={READY_STOCK_CLIENT}>
                    <span className="font-medium">🏭 Ready Stock — build for inventory</span>
                    <span className="text-muted-foreground ml-2 text-xs">no client</span>
                  </SelectItem>
                  {allClients.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-medium">{c.companyName}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.ownerName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {forReadyStock && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm mt-3">
                <PackageCheck className="h-5 w-5 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">In-house build — no client, no billing. Produce it, then add the finished piece to Ready Stock from the order page.</p>
              </div>
            )}

            {f.clientId && !forReadyStock && (() => {
              const c = allClients.find(x => x.id === f.clientId);
              return c ? (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 text-sm mt-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/15 to-brand-light/15 grid place-items-center shrink-0 text-primary font-bold text-xs">
                    {c.companyName.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.companyName}</p>
                    <p className="text-xs text-muted-foreground">{c.ownerName} · {c.country}</p>
                  </div>
                </div>
              ) : null;
            })()}
          </SectionCard>
        )}

        {/* ══ 1b. Sell from Ready Stock (optional) — not for in-house stock builds ══ */}
        {!forReadyStock && (
        <SectionCard icon={<PackageCheck className="h-4 w-4 text-primary" />} title="Sell from Ready Stock" subtitle="Optional — pick an existing finished piece instead of a custom order">
          <Select value={f.readyStockItemId || READY_STOCK_NONE} onValueChange={v => selectReadyStock(v === READY_STOCK_NONE ? "" : v)}>
            <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="None — custom order" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={READY_STOCK_NONE}>None — custom order</SelectItem>
              {readyStockItems.map(item => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} — ${item.price.toLocaleString()} ({item.quantity} available)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedStockItem && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 mt-3">
              {selectedStockItem.images?.[0] ? (
                <img src={selectedStockItem.images[0]} alt={selectedStockItem.name} className="h-14 w-14 rounded-lg object-cover shrink-0" />
              ) : (
                <div className="h-14 w-14 rounded-lg bg-secondary grid place-items-center shrink-0"><Gem className="h-6 w-6 text-muted-foreground/40" /></div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{selectedStockItem.name}</p>
                <p className="text-xs text-muted-foreground">
                  {selectedStockItem.jewelleryType} · {selectedStockItem.metal}{selectedStockItem.productKarats ? ` ${selectedStockItem.productKarats}` : ""}
                  {selectedStockItem.diamondWeight ? ` · ${selectedStockItem.diamondWeight}ct diamond` : ""}
                </p>
              </div>
              <p className="font-display text-lg font-bold text-brand-dark shrink-0">${selectedStockItem.price.toLocaleString()}</p>
            </div>
          )}

          {/* A ready piece needs no design/production details — just quantity + a note. */}
          {selectedStockItem && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Quantity">
                <Input type="number" min={1} value={f.quantity} onChange={e => set("quantity", +e.target.value)} className="rounded-xl h-11" />
              </Field>
              <Field label="Priority">
                <Select value={f.priority} onValueChange={v => set("priority", v)}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{["Normal","High Priority","Urgent"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <div className="col-span-2">
                <Field label="Note (optional)">
                  <Textarea value={f.instructions} onChange={e => set("instructions", e.target.value)} rows={2} className="rounded-xl resize-none" placeholder="Delivery notes, engraving, etc." />
                </Field>
              </div>
            </div>
          )}
        </SectionCard>
        )}

        {/* ══ 2. Order Details — replaced by a compact block for a Ready-Stock sale ══ */}
        {!isReadyStockSale && (
        <SectionCard title="Order Details">
          {/* Type + Metal — 2 cols on all screens (both short) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jewellery Type">
              <Select value={f.jewelleryType} onValueChange={setJewelleryType}>
                <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Ring","Ring + Band","Pendant","Necklace","Bracelet","Earrings","Custom","Diamond Only"].map(x =>
                    <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Metal">
              {isDiamondOnly ? (
                <div className="rounded-xl h-11 px-3 flex items-center bg-secondary/60 text-sm text-muted-foreground">None (Diamond only)</div>
              ) : (
                <Select value={f.metal} onValueChange={setMetal}>
                  <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["Gold","White Gold","Rose Gold","Platinum","Silver","None (Diamond only)"].map(x =>
                      <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Diamond Type">
              <Select value={f.diamondType} onValueChange={v => set("diamondType", v)}>
                <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Natural","Lab Grown"].map(x =>
                    <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Priority">
              <Select value={f.priority} onValueChange={v => set("priority", v)}>
                <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Normal","High Priority","Urgent"].map(x =>
                    <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Quantity">
              <Input type="number" min={1} value={f.quantity}
                onChange={e => set("quantity", +e.target.value)}
                className="rounded-xl h-11" />
            </Field>

            <Field label="Est. Diamond Weight (ct)">
              <Input type="number" step="0.01" min={0} value={f.diamondWeight}
                onChange={e => set("diamondWeight", +e.target.value)}
                className="rounded-xl h-11" placeholder="0.00" />
            </Field>

            {!isDiamondOnly && (
              <>
                {/* Estimated weight note */}
                <div className="col-span-2 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  <span className="shrink-0">⚖️</span>
                  <span>Estimated weights — actual values will be confirmed after the piece is made</span>
                </div>

                <Field label="Est. Gross Weight (g)  —  optional">
                  <Input type="number" step="0.001" min={0} value={f.estimatedGrossWeight || ""}
                    onChange={e => set("estimatedGrossWeight", +e.target.value)}
                    className="rounded-xl h-11" placeholder="0.000" />
                </Field>
                <Field label="Est. Net Weight (g)  —  optional">
                  <Input type="number" step="0.001" min={0} value={f.estimatedNetWeight || ""}
                    onChange={e => set("estimatedNetWeight", +e.target.value)}
                    className="rounded-xl h-11" placeholder="0.000" />
                </Field>
              </>
            )}
          </div>

          <Field label="Special Instructions">
            <Textarea
              value={f.instructions}
              onChange={e => set("instructions", e.target.value)}
              rows={3} className="rounded-xl resize-none"
              placeholder="Design notes, stone preferences, reference details" />
          </Field>
        </SectionCard>
        )}

        {/* ══ 3. Reference Images — not for a Ready-Stock sale (the piece has its own photos) ══ */}
        {!isReadyStockSale && (
        <SectionCard icon={<ImagePlus className="h-4 w-4 text-primary" />} title="Reference Images" subtitle="Upload up to 3 design or reference photos">
          <div className="grid grid-cols-3 gap-3">
            {images.map((src, i) => (
              <div key={i} className="relative group aspect-square rounded-xl overflow-hidden border border-border">
                <img src={src} alt={`Ref ${i + 1}`} className="w-full h-full object-cover" />
                {/* Always visible on mobile (touch can't hover), hover-only on desktop */}
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute top-1 right-1 h-7 w-7 rounded-full bg-destructive text-white grid place-items-center shadow-md
                    opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {images.length < 3 && (
              <button
                type="button"
                onClick={() => imgRef.current?.click()}
                className="aspect-square rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 active:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-1.5 text-muted-foreground"
              >
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs font-medium">{images.length === 0 ? "Add Photo" : "Add More"}</span>
              </button>
            )}
          </div>
          <input ref={imgRef} type="file" accept="image/*" multiple className="hidden"
            onChange={e => handleImageFiles(e.target.files)} />
          <p className="text-xs text-muted-foreground">JPG, PNG, WEBP · Each image compressed to ≤ 800px</p>
        </SectionCard>
        )}

        {/* ══ 4. Product Specifications — skipped for a Ready-Stock sale (specs come from the piece) ══ */}
        {!isReadyStockSale && (
        <SectionCard icon={<Gem className="h-4 w-4 text-primary" />} title="Product Specifications" subtitle={isDiamondOnly ? "Just the diamond — no jewellery piece involved" : "Design details required for manufacturing"}>

          {!isDiamondOnly && (
            <Field label="Design Number *">
              <Input value={f.designNumber} onChange={e => set("designNumber", e.target.value)}
                className="rounded-xl h-11" placeholder="e.g. SL-2024-001" required />
            </Field>
          )}

          {!isDiamondOnly && (
            <>
              <div className="space-y-1">
                <Field label="Product Size *">
                  <Input value={f.productSize} onChange={e => set("productSize", e.target.value)}
                    className="rounded-xl h-11" placeholder="e.g. Ring size 7, Bracelet 18cm, Chain 20 inches" required />
                </Field>
                <p className="text-xs text-muted-foreground pl-0.5">Mention any ring size, bracelet size or chain details here</p>
              </div>

              {/* Color + Karats — 2 cols always */}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Color *">
                  <Select value={f.productColor} onValueChange={v => set("productColor", v)} required>
                    <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {["Yellow","Rose","White"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>

                {metalHasKarats ? (
                  <Field label="Karats *">
                    <Select value={f.productKarats} onValueChange={v => set("productKarats", v)} required>
                      <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        {["9K","10K","14K","18K","22K","24K"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                ) : (
                  <div className="flex items-end pb-1">
                    <p className="text-xs text-muted-foreground">No karats for {f.metal}</p>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Delivery — 2 cols always */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Delivery Preference
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expected Date">
                <Input type="date" value={f.expectedDelivery} min={new Date().toISOString().slice(0, 10)}
                  onChange={e => set("expectedDelivery", e.target.value)}
                  className="rounded-xl h-11" />
              </Field>
              <Field label="Preferred Time">
                <Input type="time" value={f.deliveryTime}
                  onChange={e => set("deliveryTime", e.target.value)}
                  className="rounded-xl h-11" />
              </Field>
            </div>
          </div>

          {!isDiamondOnly && (
            <>
              {/* Rhodium — 2 cols mobile, 4 cols desktop */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Rhodium *</p>
                <RadioGroup value={f.rhodium} onValueChange={v => set("rhodium", v)}
                  className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {["No Rhodium","Diamond Part White","Full White","Two Tone Casting","Other"].map(opt => (
                    <label key={opt}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors text-xs leading-tight
                        ${f.rhodium === opt ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:border-primary/40 hover:bg-secondary/60 active:bg-secondary/60"}`}>
                      <RadioGroupItem value={opt} id={`r-${opt}`} className="shrink-0" />
                      <span>{opt}</span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {/* Stamping — 2 cols mobile, 4 cols desktop */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Stamping *</p>
                <RadioGroup value={f.stamping} onValueChange={v => set("stamping", v)}
                  className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {["No Stamping","KT Stamping","Diamond Weight + KT Stamp","Special Stamp"].map(opt => (
                    <label key={opt}
                      className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors text-xs leading-tight
                        ${f.stamping === opt ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:border-primary/40 hover:bg-secondary/60 active:bg-secondary/60"}`}>
                      <RadioGroupItem value={opt} id={`s-${opt}`} className="shrink-0" />
                      <span>{opt}</span>
                    </label>
                  ))}
                </RadioGroup>
                {f.stamping === "Special Stamp" && (
                  <Input value={f.stampingNote} onChange={e => set("stampingNote", e.target.value)}
                    placeholder="Describe the special stamp (e.g. custom logo, initials, text…)"
                    className="rounded-xl mt-2" autoFocus />
                )}
              </div>
            </>
          )}
        </SectionCard>
        )}

        {/* ══ 4b. Material Sourcing (staff only, optional) ══ */}
        {!isClient && f.materialSourcing === "readyStock" ? (
          <SectionCard icon={<PackageCheck className="h-4 w-4 text-primary" />} title="Material Sourcing" subtitle="Not applicable — sold from finished-goods stock">
            <p className="text-xs p-2.5 rounded-xl bg-secondary text-muted-foreground">
              This order is a direct sale from Ready Stock — the piece already exists, so no factory material issuance is needed.
            </p>
          </SectionCard>
        ) : !isClient && (
          <SectionCard icon={<Boxes className="h-4 w-4 text-primary" />} title="Material Sourcing" subtitle="Optional — decide now, or leave for later">
            <RadioGroup value={f.materialSourcing} onValueChange={v => set("materialSourcing", v)} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                { v: "later", label: "Decide later", icon: HelpCircle },
                { v: "stock", label: "Use from Stock", icon: Boxes },
                { v: "purchase", label: "Buy new for this order", icon: ShoppingBag },
              ].map(opt => (
                <label key={opt.v}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition-colors text-sm
                    ${f.materialSourcing === opt.v ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:border-primary/40 hover:bg-secondary/60"}`}>
                  <RadioGroupItem value={opt.v} id={`ms-${opt.v}`} className="shrink-0" />
                  <opt.icon className="h-4 w-4 shrink-0" />
                  <span>{opt.label}</span>
                </label>
              ))}
            </RadioGroup>

            {f.materialSourcing === "stock" && (
              isDiamondOnly ? (
                <p className="text-xs mt-3 p-2.5 rounded-xl bg-secondary text-muted-foreground">
                  Actual diamond sourcing (from stock or a new purchase) happens later from this order's Diamond section.
                </p>
              ) : (
                <p className={`text-xs mt-3 p-2.5 rounded-xl ${goldShort ? "bg-destructive/5 text-destructive" : "bg-secondary text-muted-foreground"}`}>
                  {f.productKarats
                    ? `Available in Stock: ${availableGold ?? 0}g ${f.productKarats} gold${goldShort ? " — not enough for the weight entered above, consider Buy New for the shortfall" : ""}`
                    : "Select Karats above to see live stock availability."}
                  {" "}Actual gold is issued later from the order's Factory section.
                </p>
              )
            )}
            {f.materialSourcing === "purchase" && (
              <p className="text-xs mt-3 p-2.5 rounded-xl bg-secondary text-muted-foreground">
                This just notes the intent — record the actual purchase from Suppliers (using this order's number) once confirmed, and it'll link to this order automatically.
              </p>
            )}
          </SectionCard>
        )}

        {/* ══ 4c. Assign Factory (staff only, optional) — a pure tag, no
            material movement; the client hands a factory gold in bulk well
            before any specific order exists, so this just notes who will
            make it. Independent of Material Sourcing above. Not applicable to
            a diamond-only sale — nothing is being manufactured. ══ */}
        {!isClient && !isDiamondOnly && !isReadyStockSale && (
          <SectionCard icon={<FactoryIconLucide className="h-4 w-4 text-primary" />} title="Assign Factory" subtitle="Optional — which factory will make this piece">
            <Select value={f.assignedFactoryId || "__none"} onValueChange={v => set("assignedFactoryId", v === "__none" ? "" : v)}>
              <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Not assigned yet" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Not assigned yet</SelectItem>
                {db.factories.filter(fac => fac.active !== false).map(fac => <SelectItem key={fac.id} value={fac.id}>{fac.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </SectionCard>
        )}

        {/* ══ 5. Certificate ══ */}
        <SectionCard
          icon={<BadgeCheck className="h-4 w-4 text-amber-600" />}
          title="Certificate"
          subtitle="Do you require a diamond/jewellery certificate with this order?"
          iconBg="bg-amber-50"
        >
          <RadioGroup
            value={f.certificate}
            onValueChange={v => set("certificate", v)}
            className="grid grid-cols-2 gap-3"
          >
            {(["no", "yes"] as const).map(opt => (
              <label
                key={opt}
                className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all
                  ${f.certificate === opt
                    ? opt === "yes"
                      ? "border-amber-400 bg-amber-50 text-amber-700 font-semibold shadow-sm"
                      : "border-primary bg-primary/5 text-primary font-semibold shadow-sm"
                    : "border-border hover:border-primary/40 hover:bg-secondary/60 active:bg-secondary/60"
                  }`}
              >
                <RadioGroupItem value={opt} id={`cert-${opt}`} className="shrink-0" />
                <div>
                  <p className="text-sm font-semibold capitalize">{opt === "yes" ? "Yes" : "No"}</p>
                  <p className="text-xs text-muted-foreground font-normal leading-snug mt-0.5">
                    {opt === "yes" ? "Certificate required" : "No certificate needed"}
                  </p>
                </div>
              </label>
            ))}
          </RadioGroup>

          {f.certificate === "yes" && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-amber-600 shrink-0" />
                <p className="text-sm font-semibold text-amber-800">Certificate fee</p>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-600 font-medium text-sm">$</span>
                <Input
                  type="number" min={0} step="0.01"
                  value={f.certificateFee || ""}
                  onChange={e => set("certificateFee", +e.target.value)}
                  className="rounded-xl h-11 pl-7 border-amber-300 bg-white focus:ring-amber-400/30"
                  placeholder="0"
                />
              </div>
              <p className="text-xs text-amber-700">
                This fee will be added to the order total and shown separately on the invoice.
              </p>
            </div>
          )}
        </SectionCard>

        {/* ══ 6. Order Value / Shipping / Advance — staff only, not for in-house stock builds ══ */}
        {!isClient && !forReadyStock && (
          <>
            {/* Order Value */}
            <SectionCard icon={<DollarSign className="h-4 w-4 text-brand-dark" />} title="Order Value" subtitle="Set the agreed order amount" iconBg="bg-brand-light/15">
              <Field label="Order Value (USD) *">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">$</span>
                  <Input type="number" min={0} step="0.01" required
                    value={f.orderValue || ""}
                    onChange={e => setF(p => ({ ...p, orderValue: Number(e.target.value) || 0 }))}
                    className="rounded-xl h-11 pl-7 text-base font-semibold"
                    placeholder="0" />
                </div>
              </Field>

              {/* Estimate helper — stacked on mobile so text never overflows */}
              <div className="rounded-xl bg-secondary/60 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground">Weight-based estimate</p>
                    <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
                      <p>Metal: {f.estimatedNetWeight || 0}g × ${metalRate}/g = <span className="text-foreground font-medium">${Math.round(Number(f.estimatedNetWeight) * metalRate).toLocaleString()}</span></p>
                      <p>Diamond: {f.diamondWeight}ct × ${diamondRate.toLocaleString()}/ct = <span className="text-foreground font-medium">${Math.round(Number(f.diamondWeight) * diamondRate).toLocaleString()}</span></p>
                      <p className="font-semibold text-foreground">Est. Total = ${autoValue.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
                <button type="button" onClick={applyEstimate}
                  className="w-full text-xs text-primary font-semibold bg-primary/10 hover:bg-primary/15 active:bg-primary/20 rounded-lg py-1.5 transition-colors">
                  Apply this estimate → ${autoValue.toLocaleString()}
                </button>
              </div>
            </SectionCard>

            {/* Shipping */}
            <SectionCard icon={<Truck className="h-4 w-4 text-brand-dark" />} title="Shipping Charge" subtitle="Freight / courier cost for this order" iconBg="bg-brand-light/15">
              <Field label="Shipping Charge (USD)">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">$</span>
                  <Input type="number" min={0} step="0.01"
                    value={f.shippingCharge || ""}
                    onChange={e => set("shippingCharge", +e.target.value)}
                    className="rounded-xl h-11 pl-7" placeholder="0" />
                </div>
              </Field>
            </SectionCard>

            {/* Advance Payment */}
            <SectionCard icon={<CreditCard className="h-4 w-4 text-success" />} title="Advance Payment" subtitle="Optional — enter any amount paid upfront" iconBg="bg-success/10">
              {/* Amount + Note — 2 cols on desktop only (note is wide) */}
              <div className="grid md:grid-cols-2 gap-3">
                <Field label="Advance Amount (USD)">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium text-sm">$</span>
                    <Input type="number" min={0} max={grandTotal} step="0.01"
                      value={f.advanceAmount || ""}
                      onChange={e => set("advanceAmount", +e.target.value)}
                      className="rounded-xl h-11 pl-7" placeholder="0" />
                  </div>
                </Field>
                <Field label="Payment Note">
                  <Input value={f.advanceNote} onChange={e => set("advanceNote", e.target.value)}
                    className="rounded-xl h-11" placeholder="Cash, Bank transfer, Cheque…" />
                </Field>
              </div>

              {Number(f.advanceAmount) > 0 && db.lockers.filter(l => l.active !== false).length === 0 && (
                <p className="text-xs text-amber-600 -mt-1">
                  No lockers yet — create one on the Locker page first before recording this advance.
                </p>
              )}
              {Number(f.advanceAmount) > 0 && (
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Deposited to Locker *">
                    <Select value={f.advanceLockerId} onValueChange={v => {
                      const l = db.lockers.find(x => x.id === v);
                      setF(prev => ({ ...prev, advanceLockerId: v, advanceLockerAmount: l?.currency === "USD" ? String(prev.advanceAmount) : "" }));
                    }}>
                      <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Choose a locker" /></SelectTrigger>
                      <SelectContent>
                        {db.lockers.filter(l => l.active !== false).map(l => <SelectItem key={l.id} value={l.id}>{l.name} ({l.currency || "INR"})</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  {f.advanceLockerId && (
                    <Field label={`Amount Deposited (${db.lockers.find(l => l.id === f.advanceLockerId)?.currency === "USD" ? "$" : "₹"})`}>
                      <Input type="number" min={0} step="0.01" value={f.advanceLockerAmount}
                        onChange={e => set("advanceLockerAmount", e.target.value)}
                        className="rounded-xl h-11" />
                    </Field>
                  )}
                </div>
              )}

              {/* Balance summary — always 2×2 on mobile */}
              <div className="grid grid-cols-2 gap-2.5">
                <BalanceTile label="Order Value" value={`${Number(f.orderValue).toLocaleString()}`} />
                <BalanceTile label="Shipping" value={shipping > 0 ? `${shipping.toLocaleString()}` : "—"} />
                <BalanceTile
                  label="Certificate Fee"
                  value={certFee > 0 ? `${certFee.toLocaleString()}` : "—"}
                  highlight={certFee > 0 ? "cert" : undefined}
                />
                <BalanceTile
                  label="Advance Paid"
                  value={`${Number(f.advanceAmount || 0).toLocaleString()}`}
                  highlight={f.advanceAmount > 0 ? "success" : undefined}
                />
                <BalanceTile
                  label="Balance Due"
                  value={balanceDue > 0 ? `${balanceDue.toLocaleString()}` : "✓ Cleared"}
                  highlight={balanceDue > 0 ? "danger" : "success"}
                />
              </div>

              {/* Grand total line */}
              {(shipping > 0 || certFee > 0) && (
                <p className="text-xs text-muted-foreground px-1">
                  Grand total (order{shipping > 0 ? " + shipping" : ""}{certFee > 0 ? " + certificate" : ""}):&nbsp;
                  <span className="font-semibold text-foreground">${grandTotal.toLocaleString()}</span>
                </p>
              )}
            </SectionCard>
          </>
        )}

        {/* Pricing notice for clients */}
        {isClient && (
          <div className="card-luxe p-4 flex items-start gap-3 bg-secondary/40">
            <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-sm text-muted-foreground">
              {f.materialSourcing === "readyStock"
                ? `This is a fixed-price item from Ready Stock — ${f.orderValue ? `$${f.orderValue.toLocaleString()}` : "price"} — no separate quote is needed.`
                : "Pricing will be set by our team after reviewing your request — no payment details are needed from you right now."}
            </p>
          </div>
        )}

        {/* ── Gift Card ── */}
        {!forReadyStock && giftClientId && giftCard && (
          <SectionCard icon={<Gift className="h-4 w-4 text-primary" />} title="Gift Card" subtitle="Apply available gift-card credit to this order">
            {giftMax > 0 ? (
              <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${redeemGift ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"}`}>
                <input type="checkbox" checked={redeemGift} onChange={e => setRedeemGift(e.target.checked)} className="mt-1 h-4 w-4 accent-current text-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-dark">Apply gift card — save up to ${giftMax.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Up to {Math.round(giftPct * 100)}% of the order · balance ${giftBalance.toLocaleString()} · expires {new Date(giftCard.expiresAt).toLocaleDateString()}
                  </p>
                  {willRedeem && <p className="text-xs font-medium text-success mt-1">New total after gift card: ${(grandTotal - giftMax).toLocaleString()}</p>}
                </div>
              </label>
            ) : (
              <p className="text-xs p-3 rounded-xl bg-primary/5 border border-primary/20 text-muted-foreground">
                This client has <span className="font-semibold text-foreground">${giftBalance.toLocaleString()}</span> in gift-card credit. It will be applied to this order once it's priced — up to {Math.round(giftPct * 100)}% per order.
              </p>
            )}
          </SectionCard>
        )}

        {/* ── Submit / Cancel — sticky so the action is always reachable on a long form ── */}
        <div className="sticky bottom-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-3 py-3 border-t border-border/60 bg-white/92 backdrop-blur sm:rounded-xl">
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5">
            <Button type="button" variant="outline" onClick={() => nav(-1)} className="rounded-xl h-11 w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="btn-hero rounded-xl h-11 sm:px-10 w-full sm:w-auto">
              {saving ? "Submitting…" : "Submit Order"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ── Reusable section card ── */
function SectionCard({
  icon, title, subtitle, iconBg = "bg-primary/10", children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  iconBg?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-luxe p-4 md:p-6 space-y-4">
      {(icon || subtitle) ? (
        <div className="flex items-center gap-2.5">
          {icon && (
            <div className={`h-8 w-8 rounded-lg ${iconBg} grid place-items-center shrink-0`}>
              {icon}
            </div>
          )}
          <div>
            <h2 className="font-semibold text-brand-dark text-sm md:text-base">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      ) : (
        <h2 className="font-semibold text-brand-dark text-sm md:text-base">{title}</h2>
      )}
      {children}
    </div>
  );
}

/* ── Balance tile ── */
function BalanceTile({
  label, value, highlight,
}: {
  label: string;
  value: string;
  highlight?: "success" | "danger" | "cert";
}) {
  const bg = highlight === "success"
    ? "bg-success/8 border border-success/20"
    : highlight === "danger"
    ? "bg-destructive/5 border border-destructive/20"
    : highlight === "cert"
    ? "bg-amber-50 border border-amber-200"
    : "bg-secondary";
  const textColor = highlight === "success"
    ? "text-success"
    : highlight === "danger"
    ? "text-destructive"
    : highlight === "cert"
    ? "text-amber-700"
    : "text-brand-dark";
  return (
    <div className={`${bg} rounded-xl p-3 text-center`}>
      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">{label}</p>
      <p className={`font-semibold text-sm ${textColor}`}>{value}</p>
    </div>
  );
}

/* ── Form field wrapper ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
