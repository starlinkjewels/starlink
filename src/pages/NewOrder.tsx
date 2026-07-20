import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, uid, TIMELINE_STEPS, type Order } from "@/lib/db";
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
import { DollarSign, Building2, ImagePlus, X, Gem, Clock, Sparkles, Truck, CreditCard, AlertCircle, BadgeCheck } from "lucide-react";

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
  const isAdmin    = user?.role === "admin";
  const isEmployee = user?.role === "employee";
  const isClient   = user?.role === "client";

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
    orderValue: 0,
    shippingCharge: defaultShipping,
    advanceAmount: 0,
    advanceNote: "",
    certificate: "no" as "yes" | "no",
    certificateFee: 50,
  });

  const [images, setImages] = useState<string[]>([]);
  const imgRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

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

  const metalHasKarats = !["Silver", "Platinum"].includes(f.metal);

  const setMetal = (v: string) => {
    setF(prev => ({
      ...prev,
      metal: v,
      productKarats: ["Silver", "Platinum"].includes(v) ? "" : prev.productKarats,
    }));
  };

  const applyEstimate = () => {
    const auto = Math.round(Number(f.diamondWeight) * diamondRate);
    setF(prev => ({ ...prev, orderValue: auto }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isClient && !isAdmin && !isEmployee) { toast.error("You don't have permission to create orders."); return; }
    if ((isAdmin || isEmployee) && !f.clientId) { toast.error("Please select a client for this order."); return; }
    if (!isClient && f.orderValue <= 0) { toast.error("Please enter a valid order value."); return; }
    if (!f.designNumber.trim()) { toast.error("Design Number is required."); return; }
    if (!f.productSize.trim())  { toast.error("Product Size is required."); return; }
    if (!f.productColor)        { toast.error("Color of Product is required."); return; }
    if (metalHasKarats && !f.productKarats) { toast.error("Karats of Product is required."); return; }
    if (!f.rhodium)             { toast.error("Please select a Rhodium option."); return; }
    if (!f.stamping)            { toast.error("Please select a Stamping option."); return; }

    setSaving(true);
    const clientId = isClient ? user!.clientId! : f.clientId;

    updateDb(d => {
      const num = `SLJ-${new Date().getFullYear()}-${String(1000 + d.orders.length + 1).padStart(4, "0")}`;
      const advance = Number(f.advanceAmount) || 0;

      const order: Order = {
        id: uid("o_"),
        orderNumber: num,
        clientId,
        contactPerson: user!.name,
        jewelleryType: f.jewelleryType as Order["jewelleryType"],
        metal: f.metal as Order["metal"],
        diamondType: f.diamondType as Order["diamondType"],
        quantity: Number(f.quantity),
        diamondWeight: Number(f.diamondWeight),
        metalWeight: 0,
        estimatedGrossWeight: Number(f.estimatedGrossWeight) || undefined,
        estimatedNetWeight: Number(f.estimatedNetWeight) || undefined,
        images,
        designNumber: f.designNumber || undefined,
        productSize: f.productSize || undefined,
        productColor: f.productColor || undefined,
        productKarats: f.productKarats || undefined,
        deliveryTime: f.deliveryTime || undefined,
        rhodium: f.rhodium || undefined,
        stamping: f.stamping || undefined,
        certificate: f.certificate === "yes",
        certificateFee: f.certificate === "yes" ? (Number(f.certificateFee) || 0) : 0,
        instructions: f.instructions,
        expectedDelivery: f.expectedDelivery || new Date(Date.now() + 45 * 86400000).toISOString(),
        priority: f.priority as Order["priority"],
        status: "Waiting",
        amount: f.orderValue,
        shippingCharge: Number(f.shippingCharge) || 0,
        advances: advance > 0 ? [{
          id: uid("adv_"),
          amount: advance,
          note: f.advanceNote || "Initial advance",
          recordedBy: user!.id,
          createdAt: new Date().toISOString(),
        }] : [],
        timeline: TIMELINE_STEPS.map((s, i) => ({
          step: s,
          status: i === 0 ? "done" : "pending" as "done" | "pending",
          date: i === 0 ? new Date().toISOString() : undefined,
        })),
        createdAt: new Date().toISOString(),
      };

      d.orders.unshift(order);

      if (isClient) {
        const admin = d.users.find(u => u.role === "admin");
        if (admin) d.notifications.unshift({
          id: uid("n_"), userId: admin.id,
          title: "New Order Request",
          body: `${order.orderNumber} from ${d.clients.find(c => c.id === clientId)?.companyName ?? "client"}${advance > 0 ? ` · Advance $${advance}` : ""}`,
          type: "order", read: false, createdAt: new Date().toISOString(),
        });
      }

      if (isAdmin || isEmployee) {
        const clientUser = d.users.find(u => u.clientId === clientId && u.role === "client");
        if (clientUser) d.notifications.unshift({
          id: uid("n_"), userId: clientUser.id,
          title: "Order Created",
          body: `${order.orderNumber} has been created for your account.`,
          type: "order", read: false, createdAt: new Date().toISOString(),
        });
      }
    });

    toast.success("Order submitted successfully");
    nav("/orders");
  };

  const shipping   = Number(f.shippingCharge) || 0;
  const certFee    = f.certificate === "yes" ? (Number(f.certificateFee) || 0) : 0;
  const grandTotal = Number(f.orderValue) + shipping + certFee;
  const balanceDue = Math.max(0, grandTotal - Number(f.advanceAmount));
  const autoValue  = Math.round(Number(f.estimatedNetWeight) * metalRate + Number(f.diamondWeight) * diamondRate);

  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* ── Page header ── */}
      <div className="pb-1">
        <h1 className="font-display text-2xl md:text-3xl text-brand-dark">New Order</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isClient ? "Submit a new jewellery order request" : "Create an order on behalf of a client"}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4">

        {/* ══ 1. Client selector (admin / employee only) ══ */}
        {(isAdmin || isEmployee) && (
          <SectionCard icon={<Building2 className="h-4 w-4 text-primary" />} title="Client" subtitle="Select the client this order belongs to">
            <Field label="Select Client *">
              <Select value={f.clientId} onValueChange={v => set("clientId", v)} required>
                <SelectTrigger className="rounded-xl h-11"><SelectValue placeholder="Choose a client…" /></SelectTrigger>
                <SelectContent>
                  {allClients.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="font-medium">{c.companyName}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{c.ownerName}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {f.clientId && (() => {
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

        {/* ══ 2. Order Details ══ */}
        <SectionCard title="Order Details">
          {/* Type + Metal — 2 cols on all screens (both short) */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Jewellery Type">
              <Select value={f.jewelleryType} onValueChange={v => set("jewelleryType", v)}>
                <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Ring","Pendant","Necklace","Bracelet","Earrings","Custom"].map(x =>
                    <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Metal">
              <Select value={f.metal} onValueChange={setMetal}>
                <SelectTrigger className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Gold","White Gold","Rose Gold","Platinum","Silver"].map(x =>
                    <SelectItem key={x} value={x}>{x}</SelectItem>)}
                </SelectContent>
              </Select>
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
          </div>

          <Field label="Special Instructions">
            <Textarea
              value={f.instructions}
              onChange={e => set("instructions", e.target.value)}
              rows={3} className="rounded-xl resize-none"
              placeholder="Design notes, stone preferences, reference details" />
          </Field>
        </SectionCard>

        {/* ══ 3. Reference Images ══ */}
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

        {/* ══ 4. Product Specifications ══ */}
        <SectionCard icon={<Gem className="h-4 w-4 text-primary" />} title="Product Specifications" subtitle="Design details required for manufacturing">

          <Field label="Design Number *">
            <Input value={f.designNumber} onChange={e => set("designNumber", e.target.value)}
              className="rounded-xl h-11" placeholder="e.g. SL-2024-001" required />
          </Field>

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
                    {["14K","18K","22K","24K"].map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            ) : (
              <div className="flex items-end pb-1">
                <p className="text-xs text-muted-foreground">No karats for {f.metal}</p>
              </div>
            )}
          </div>

          {/* Delivery — 2 cols always */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Delivery Preference
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Expected Date">
                <Input type="date" value={f.expectedDelivery}
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

          {/* Rhodium — 2 cols mobile, 4 cols desktop */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">Rhodium *</p>
            <RadioGroup value={f.rhodium} onValueChange={v => set("rhodium", v)}
              className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {["No Rhodium","Diamond Part White","Full White","Other"].map(opt => (
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
              {["No Stamping","KT Stamping","Diamond Weight + KT Stamp","Other"].map(opt => (
                <label key={opt}
                  className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition-colors text-xs leading-tight
                    ${f.stamping === opt ? "border-primary bg-primary/5 text-primary font-semibold" : "border-border hover:border-primary/40 hover:bg-secondary/60 active:bg-secondary/60"}`}>
                  <RadioGroupItem value={opt} id={`s-${opt}`} className="shrink-0" />
                  <span>{opt}</span>
                </label>
              ))}
            </RadioGroup>
          </div>
        </SectionCard>

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

        {/* ══ 6. Order Value / Shipping / Advance — staff only ══ */}
        {!isClient && (
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
              Pricing will be set by our team after reviewing your request — no payment details are needed from you right now.
            </p>
          </div>
        )}

        {/* ── Submit / Cancel ── */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pb-4">
          <Button type="button" variant="outline" onClick={() => nav(-1)} className="rounded-xl h-11 sm:w-auto w-full">
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="btn-hero rounded-xl h-11 sm:px-8 w-full sm:w-auto">
            {saving ? "Submitting…" : "Submit Order"}
          </Button>
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
