import {
  loadDb, updateDb, buildTimelineSteps,
  type DB, type Order, type TimelineEntry, type AdvancePayment,
  type Client, type Supplier, type Factory, type Locker, type User,
  type ReadyStockItem, type DiamondPacket, type Purchase, type StockMovement,
  type MaterialIssuance, type Expense, type ClientReceipt, type LockerTransaction,
  writeFxTable, writeStockCost,
} from "@/lib/db";

/**
 * Sample data for the demo, so the app can be shown doing its job instead of
 * sitting empty.
 *
 * Built out of the app's own types and written through the app's own
 * `updateDb`, so it is exactly the shape the screens read — a dataset poked
 * into the database by hand would drift from the model the moment either
 * changed.
 *
 * Every record is dated relative to the day it is seeded, so the demo always
 * looks like a business running this week rather than one abandoned months ago.
 * Ids are fixed strings beginning `demo_`, which makes seeding twice replace
 * the sample rather than duplicate it, and makes the sample easy to tell from
 * anything entered during the demo itself.
 */

/** N days ago, carrying a plausible working hour. */
function daysAgo(n: number, hour = 11): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, (n * 7) % 60, 0, 0);
  return d.toISOString();
}

/** N days ahead, as the yyyy-mm-dd a delivery date is held in. */
function daysAhead(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A timeline with the first `done` stages closed and the next one running.
 *
 * Built from buildTimelineSteps so it carries exactly the stages a real order
 * of that kind would — including dropping the production stages a diamond-only
 * order never has.
 */
function timeline(done: number, certified = false, startedDaysAgo = 30, diamondOnly = false): TimelineEntry[] {
  const steps = buildTimelineSteps(certified, diamondOnly);
  return steps.map((step, i) => {
    if (i < done) {
      // Spread the closed stages across the time since the order was taken, so
      // the progress bar and the dates tell the same story.
      const span = Math.max(1, Math.floor(startedDaysAgo / Math.max(done, 1)));
      return { step, status: "done" as const, date: daysAgo(startedDaysAgo - i * span), remarks: "Completed" };
    }
    if (i === done) return { step, status: "in_progress" as const };
    return { step, status: "pending" as const };
  });
}

/** Receipts and the account entries they make, gathered while the orders are
 *  built so every payment is a real numbered receipt, the way they are taken. */
let receipts: ClientReceipt[] = [];
let ledger: LockerTransaction[] = [];

/**
 * A payment against an order. With a rate, it landed in the rupee account and
 * was converted at that rate — which is what the exchange gain or loss is
 * measured from. Without one, it sits in the dollar account, not yet converted.
 */
function advance(id: string, amount: number, daysBack: number, note = "Advance received", rate?: number, clientId = ""): AdvancePayment {
  const at = daysAgo(daysBack, 15);
  const rid = `demo_rc_${id}`;
  const usdAccount = rate === undefined;
  const lockerId = usdAccount ? "demo_l3" : "demo_l1";
  const landed = usdAccount ? amount : Math.round(amount * rate! * 100) / 100;
  receipts.push({
    id: rid, receiptNo: `D-${String(receipts.length + 1).padStart(4, "0")}`, clientId, date: at, amountUsd: amount,
    lockerId, lockerAmount: landed, lockerCurrency: usdAccount ? "USD" : "INR",
    ...(usdAccount ? {} : { exchangeRate: rate }),
    method: "Bank Transfer", remarks: note, recordedBy: "demo_admin", createdAt: at,
  });
  ledger.push({
    id: `demo_ltx_${id}`, lockerId, type: "income", amountInr: landed, currency: usdAccount ? "USD" : "INR",
    category: "Client Payment", refType: "clientPayment", receiptId: rid,
    ...(usdAccount ? {} : { exchangeRate: rate }), recordedBy: "demo_admin", createdAt: at,
  });
  return { id: `demo_adv_${id}`, amount, note, recordedBy: "demo_admin", createdAt: at, receiptId: rid };
}

/** Everything an order needs that is the same for all of the samples. */
function order(o: Partial<Order> & Pick<Order, "id" | "orderNumber" | "clientId" | "jewelleryType" | "status" | "amount">): Order {
  return {
    contactPerson: "", metal: "Gold", diamondType: "Natural", quantity: 1,
    diamondWeight: 0, metalWeight: 0, images: [], instructions: "",
    expectedDelivery: daysAhead(14), priority: "Normal",
    shippingCharge: 0, advances: [], timeline: timeline(2),
    createdAt: daysAgo(30), productColor: "Yellow", productKarats: "14K",
    ...o,
  };
}

export function buildDemoData(): Partial<DB> {
  receipts = [];
  ledger = [];
  const clients: Client[] = [
    { id: "demo_c1", companyName: "GIVARA JEWELRY", ownerName: "Ravi Mehta", email: "ravi@givara.example", phone: "+1 212 555 0142", country: "United States", gstVat: "US-88-4421", address: "47 W 47th St, New York, NY 10036", username: "givara", password: "", status: "active" as const, createdAt: daysAgo(400), productPhotoAccess: true, giftCardEnabled: true, cashbackPercent: 2 },
    { id: "demo_c2", companyName: "AMATI DESIGNS", ownerName: "Sara Amati", email: "sara@amati.example", phone: "+1 310 555 0188", country: "United States", gstVat: "US-91-7730", address: "550 S Hill St, Los Angeles, CA 90013", username: "amati", password: "", status: "active" as const, createdAt: daysAgo(320), productPhotoAccess: true },
    { id: "demo_c3", companyName: "KC Gold and Diamond Trade", ownerName: "Kenji Chen", email: "kenji@kcgold.example", phone: "+852 5555 0199", country: "Hong Kong", gstVat: "HK-5521-09", address: "Unit 12, Kowloon, Hong Kong", username: "kcgold", password: "", status: "active" as const, createdAt: daysAgo(260) },
    { id: "demo_c4", companyName: "Mel White Fine Jewels", ownerName: "Melanie White", email: "mel@melwhite.example", phone: "+44 20 5555 0121", country: "United Kingdom", gstVat: "GB-442-1180", address: "18 Hatton Garden, London EC1N", username: "melwhite", password: "", status: "active" as const, createdAt: daysAgo(150) },
  ];

  const suppliers: Supplier[] = [
    { id: "demo_s1", name: "Paresh Savaliya", contactPerson: "Paresh", phone: "+91 98250 11223", address: "Mahidharpura, Surat", gstin: "24AAAPS1234L1ZV", createdAt: daysAgo(500), active: true },
    { id: "demo_s2", name: "HARESH MAKANI", contactPerson: "Haresh", phone: "+91 98790 44556", address: "Varachha, Surat", gstin: "24AABCM5678P1ZK", createdAt: daysAgo(480), active: true },
    { id: "demo_s3", name: "DUBAI HAPPY GOLD", contactPerson: "Imran", phone: "+971 55 555 0100", address: "Gold Souk, Deira, Dubai", createdAt: daysAgo(300), active: true },
  ];

  const factories: Factory[] = [
    { id: "demo_f1", name: "Shreeji Manufacturing", contactPerson: "Nikunj Bhai", phone: "+91 98240 77881", address: "Katargam, Surat", createdAt: daysAgo(450), active: true },
    { id: "demo_f2", name: "Krishna Casting Works", contactPerson: "Paresh Bhai", phone: "+91 97260 33442", address: "Ring Road, Surat", createdAt: daysAgo(380), active: true },
  ];

  const lockers: Locker[] = [
    { id: "demo_l1", name: "HDFC Current A/c", type: "bank" as const, currency: "INR" as const, accountNumberLast4: "4417", openingBalance: 1850000, createdAt: daysAgo(500), active: true },
    { id: "demo_l2", name: "Cash Drawer", type: "cash" as const, currency: "INR" as const, openingBalance: 125000, createdAt: daysAgo(500), active: true },
    { id: "demo_l3", name: "USD Remittance A/c", type: "bank" as const, currency: "USD" as const, accountNumberLast4: "9021", openingBalance: 14200, createdAt: daysAgo(400), active: true },
  ];

  const users: User[] = [
    { id: "demo_e1", username: "nisha", password: "", role: "employee" as const, name: "Nisha Patel", email: "nisha@demo.example", phone: "+91 98252 10101", department: "Sales", status: "active" as const, createdAt: daysAgo(300) },
    { id: "demo_e2", username: "arjun", password: "", role: "employee" as const, name: "Arjun Shah", email: "arjun@demo.example", phone: "+91 98252 20202", department: "Production", status: "active" as const, createdAt: daysAgo(260) },
  ];

  // Orders across every stage the board shows, so the pipeline is not all one
  // colour: work just taken, work at the factory, work finished and waiting,
  // work shipped, and work closed and billed.
  const orders: Order[] = [
    order({
      id: "demo_o1", orderNumber: "SLJ-2026-1070", clientId: "demo_c1", designNumber: "LR-534",
      jewelleryType: "Ring", metal: "Gold", productKarats: "14K", status: "In Production",
      amount: 1420, diamondWeight: 1.18, metalWeight: 3.9, estimatedNetWeight: 3.9,
      estimatedGrossWeight: 4.14, productSize: "US 7", createdAt: daysAgo(18),
      timeline: timeline(4, false, 18), expectedDelivery: daysAhead(9),
      assignedEmployeeId: "demo_e2", advances: [advance("1", 500, 16, "Advance received", 84.0, "demo_c1")],
      instructions: "Marquise centre, cathedral shank. Match LR-512 finish.",
    }),
    order({
      id: "demo_o2", orderNumber: "SLJ-2026-1069", clientId: "demo_c4", designNumber: "LR-514",
      jewelleryType: "Ring", metal: "Gold", productKarats: "14K", status: "Delivered",
      amount: 1480, diamondWeight: 1.02, metalWeight: 3.4,
      estimatedNetWeight: 3.4, actualNetWeight: 3.37, actualGrossWeight: 3.58,
      actualDiamondWeight: 1.04, actualDiamondPcs: 42, factoryBillNo: "SHJ/1188",
      productSize: "US 6", createdAt: daysAgo(62), expectedDelivery: daysAhead(-14),
      timeline: timeline(7, false, 62), assignedEmployeeId: "demo_e1",
      courierName: "FedEx", trackingNumber: "7792 4410 8831", dispatchedAt: daysAgo(18),
      deliveredAt: daysAgo(12), shippingCharge: 45,
      advances: [advance("2a", 700, 60, "Advance received", 82.95, "demo_c4"), advance("2b", 825, 14, "Balance on delivery", 84.55, "demo_c4")],
    }),
    order({
      id: "demo_o3", orderNumber: "SLJ-2026-1068", clientId: "", forReadyStock: true, readyStockCreatedId: "demo_rs1",
      designNumber: "LR-520", jewelleryType: "Ring", metal: "White Gold", productKarats: "14K",
      status: "Ready", amount: 0, diamondWeight: 0.86, metalWeight: 3.1,
      estimatedNetWeight: 3.1, actualNetWeight: 3.08, actualDiamondWeight: 0.88,
      createdAt: daysAgo(40), timeline: timeline(5, false, 40), expectedDelivery: daysAhead(-2),
      instructions: "Bypass shank, pavé set. For stock.",
    }),
    order({
      id: "demo_o4", orderNumber: "SLJ-2026-1067", clientId: "demo_c1", designNumber: "LR-1568",
      jewelleryType: "Ring", metal: "Gold", productKarats: "10K", status: "Ready",
      amount: 607, diamondWeight: 0.42, metalWeight: 2.8, estimatedNetWeight: 2.8,
      actualNetWeight: 2.84, actualGrossWeight: 2.93, actualDiamondWeight: 0.44,
      actualDiamondPcs: 8, factoryBillNo: "KCW/0442", productSize: "US 9",
      createdAt: daysAgo(34), timeline: timeline(5, false, 34), expectedDelivery: daysAhead(4),
      assignedEmployeeId: "demo_e2", advances: [advance("4", 300, 30, "Advance received", 84.1, "demo_c1")],
    }),
    order({
      id: "demo_o5", orderNumber: "SLJ-2026-1066", clientId: "demo_c2", designNumber: "LE-126",
      jewelleryType: "Earrings", metal: "Gold", productKarats: "14K", status: "Dispatched",
      amount: 1800, diamondWeight: 2.04, metalWeight: 4.2,
      estimatedNetWeight: 4.2, actualNetWeight: 4.16, actualGrossWeight: 4.57,
      actualDiamondWeight: 2.06, actualDiamondPcs: 4, factoryBillNo: "SHJ/1174",
      createdAt: daysAgo(55), timeline: timeline(6, false, 55), expectedDelivery: daysAhead(-5),
      courierName: "DHL", trackingNumber: "JD01 4455 9087", dispatchedAt: daysAgo(4),
      shippingCharge: 60, assignedEmployeeId: "demo_e1",
      advances: [advance("5", 900, 52, "Advance received", undefined, "demo_c2")],
    }),
    order({
      id: "demo_o6", orderNumber: "SLJ-2026-1065", clientId: "demo_c3", designNumber: "LR-525",
      jewelleryType: "Ring", metal: "Rose Gold", productKarats: "14K", status: "In Production",
      amount: 1700, diamondWeight: 1.51, metalWeight: 3.6, estimatedNetWeight: 3.6,
      productSize: "US 6.5", createdAt: daysAgo(21), timeline: timeline(3, false, 21),
      expectedDelivery: daysAhead(11), assignedEmployeeId: "demo_e2",
      priority: "Urgent", instructions: "Marquise halo. Rose gold, no rhodium.",
    }),
    order({
      id: "demo_o7", orderNumber: "SLJ-2026-1064", clientId: "demo_c2", designNumber: "LP-233",
      jewelleryType: "Pendant", metal: "White Gold", productKarats: "18K", status: "Approved",
      amount: 980, diamondWeight: 0.75, metalWeight: 2.4, estimatedNetWeight: 2.4,
      createdAt: daysAgo(8), timeline: timeline(2, false, 8), expectedDelivery: daysAhead(22),
      assignedEmployeeId: "demo_e1", advances: [advance("7", 400, 6, "Advance received", 84.4, "demo_c2")],
    }),
    order({
      id: "demo_o8", orderNumber: "SLJ-2026-1063", clientId: "demo_c4", designNumber: "LB-077",
      jewelleryType: "Bracelet", metal: "Gold", productKarats: "14K", status: "Waiting",
      amount: 0, diamondWeight: 3.2, metalWeight: 11.5, estimatedNetWeight: 11.5,
      createdAt: daysAgo(3), timeline: timeline(1, false, 3), expectedDelivery: daysAhead(35),
      instructions: "Tennis bracelet, 7 inch. Quote needed before approval.",
    }),
    order({
      id: "demo_o9", orderNumber: "SLJ-2026-1062", clientId: "demo_c1", designNumber: "LN-410",
      jewelleryType: "Necklace", metal: "Gold", productKarats: "18K", status: "Delivered",
      amount: 3250, diamondWeight: 2.8, metalWeight: 9.4,
      estimatedNetWeight: 9.4, actualNetWeight: 9.52, actualGrossWeight: 10.08,
      actualDiamondWeight: 2.84, actualDiamondPcs: 96, factoryBillNo: "SHJ/1150",
      createdAt: daysAgo(95), timeline: timeline(7, false, 95), expectedDelivery: daysAhead(-40),
      courierName: "FedEx", trackingNumber: "7791 8820 4417", dispatchedAt: daysAgo(44),
      deliveredAt: daysAgo(38), shippingCharge: 75, assignedEmployeeId: "demo_e1",
      advances: [advance("9a", 1600, 90, "Advance received", 82.7, "demo_c1"), advance("9b", 1725, 40, "Balance before dispatch", 83.8, "demo_c1")],
    }),
    order({
      id: "demo_o10", orderNumber: "SLJ-2026-1061", clientId: "demo_c3", designNumber: "LR-498",
      jewelleryType: "Ring", metal: "Platinum", otherMetal: "Gold", otherMetalWeight: 1.2,
      productKarats: "950", status: "In Production", amount: 2240, diamondWeight: 1.35,
      metalWeight: 5.8, estimatedNetWeight: 5.8, createdAt: daysAgo(26),
      timeline: timeline(4, false, 26), expectedDelivery: daysAhead(7),
      assignedEmployeeId: "demo_e2", priority: "High Priority",
      instructions: "Platinum head, gold shank. Two tone.",
    }),
    order({
      id: "demo_o11", orderNumber: "SLJ-2026-1060", clientId: "demo_c2",
      jewelleryType: "Diamond Only", metal: "None (Diamond only)", status: "Dispatched",
      amount: 5450, diamondWeight: 2.01, metalWeight: 0, diamondType: "Natural",
      createdAt: daysAgo(30), timeline: timeline(3, false, 30, true), expectedDelivery: daysAhead(-8),
      courierName: "Malca-Amit", trackingNumber: "MA-5541-99", dispatchedAt: daysAgo(6),
      advances: [advance("11", 5450, 28, "Paid in full", 84.25, "demo_c2")],
      instructions: "Loose certified stone, no mounting.",
    }),
    order({
      id: "demo_o12", orderNumber: "SLJ-2026-1059", clientId: "demo_c4", designNumber: "LR-467",
      jewelleryType: "Ring + Band", metal: "White Gold", productKarats: "14K", status: "Rejected",
      amount: 1150, diamondWeight: 0.9, metalWeight: 5.1, createdAt: daysAgo(70),
      timeline: timeline(1, false, 70), expectedDelivery: daysAhead(-20),
      instructions: "Client changed to a different design — cancelled.",
    }),
  ];

  const readyStock: ReadyStockItem[] = [
    { id: "demo_rs1", name: "Marquise Solitaire Ring", jewelleryType: "Ring" as const, metal: "White Gold" as const, productKarats: "14K", grossWeight: 3.42, netWeight: 3.08, diamondWeight: 0.88, diamondType: "Natural" as const, price: 1250, cost: 760, quantity: 1, images: [], sku: "RS-0041", location: "US", notes: "Bypass shank, pavé set.", createdBy: "demo_admin", createdAt: daysAgo(12) },
    { id: "demo_rs2", name: "Round Halo Stud Pair", jewelleryType: "Earrings" as const, metal: "Gold" as const, productKarats: "14K", grossWeight: 2.86, netWeight: 2.44, diamondWeight: 1.1, diamondType: "Lab Grown" as const, price: 890, cost: 520, quantity: 3, images: [], sku: "RS-0042", location: "India", createdBy: "demo_admin", createdAt: daysAgo(26) },
    { id: "demo_rs3", name: "Bezel Band 10K", jewelleryType: "Ring" as const, metal: "Gold" as const, productKarats: "10K", grossWeight: 2.93, netWeight: 2.84, diamondWeight: 0.44, diamondType: "Natural" as const, price: 607, cost: 355, quantity: 2, images: [], sku: "RS-0043", location: "US", createdBy: "demo_admin", createdAt: daysAgo(5) },
    { id: "demo_rs4", name: "Emerald Cut Eternity Band", jewelleryType: "Ring" as const, metal: "White Gold" as const, productKarats: "18K", grossWeight: 4.1, netWeight: 3.52, diamondWeight: 1.74, diamondType: "Natural" as const, price: 2100, cost: 1280, quantity: 0, images: [], sku: "RS-0038", location: "Hong Kong", notes: "Sold — kept for reference.", createdBy: "demo_admin", createdAt: daysAgo(64) },
  ];

  const diamondPackets: DiamondPacket[] = [
    { id: "demo_dp1", stockNumber: "DP-0080", shape: "Marquise", carat: 1.8, color: "E", clarity: "VS1", cut: "EX", polish: "EX", symmetry: "EX", fluorescence: "N", measurement: "11.20 x 5.60 x 3.45 mm", certificateNumber: "839640070", certificateLab: "IGI", ratePerCaratInr: 8859, supplierId: "demo_s1", status: "in_stock" as const, createdBy: "demo_admin", createdAt: daysAgo(2) },
    { id: "demo_dp2", stockNumber: "DP-0081", shape: "Round", carat: 2.01, color: "F", clarity: "VVS2", cut: "EX", polish: "EX", symmetry: "EX", fluorescence: "N", measurement: "8.10 x 8.14 x 5.02 mm", certificateNumber: "6531681140", certificateLab: "GIA", ratePerCaratInr: 238144, supplierId: "demo_s2", status: "issued" as const, orderId: "demo_o11", createdBy: "demo_admin", createdAt: daysAgo(30) },
    { id: "demo_dp3", stockNumber: "DP-0082", shape: "Oval", carat: 1.25, color: "G", clarity: "VS2", cut: "EX", polish: "VG", symmetry: "EX", fluorescence: "F", measurement: "8.90 x 6.10 x 3.80 mm", certificateNumber: "LG604417821", certificateLab: "IGI", ratePerCaratInr: 21400, supplierId: "demo_s1", status: "in_stock" as const, createdBy: "demo_admin", createdAt: daysAgo(9) },
  ];

  // ── What it all cost: stock bought, material bought for orders, the factory's
  //    charges, freight, and the running costs of the business. ──
  const pur = (id: string, o: Partial<Purchase> & Pick<Purchase, "supplierId" | "material" | "purpose" | "totalInr">, daysBack: number): Purchase => ({
    id, currency: "INR", payments: [], createdBy: "demo_admin", createdAt: daysAgo(daysBack, 11),
    invoiceDate: daysAgo(daysBack, 11), ...o,
  });
  const purchases: Purchase[] = [
    // Into the stock pool, at different prices — the running average works from these.
    pur("demo_pu_g14", { supplierId: "demo_s3", material: "gold", purpose: "stock", gold: { weightGrams: 60, purity: "14K", ratePerGram: 6150 }, totalInr: 369000, invoiceNumber: "DHG-2041" }, 140),
    pur("demo_pu_g14b", { supplierId: "demo_s3", material: "gold", purpose: "stock", gold: { weightGrams: 25, purity: "14K", ratePerGram: 6420 }, totalInr: 160500, invoiceNumber: "DHG-2077" }, 45),
    pur("demo_pu_g18", { supplierId: "demo_s3", material: "gold", purpose: "stock", gold: { weightGrams: 30, purity: "18K", ratePerGram: 7480 }, totalInr: 224400, invoiceNumber: "DHG-2052" }, 130),
    pur("demo_pu_g10", { supplierId: "demo_s3", material: "gold", purpose: "stock", gold: { weightGrams: 20, purity: "10K", ratePerGram: 4380 }, totalInr: 87600, invoiceNumber: "DHG-2058" }, 120),
    pur("demo_pu_dR", { supplierId: "demo_s1", material: "diamond", purpose: "stock", diamond: { carat: 12, pieces: 120, ratePerCarat: 41500, kind: "loose", shape: "Round" }, totalInr: 498000, invoiceNumber: "PS-118" }, 110),
    // Bought for one order and sent straight to the factory.
    pur("demo_pu_o2", { supplierId: "demo_s3", material: "gold", purpose: "order", orderId: "demo_o2", gold: { weightGrams: 3.4, purity: "14K", ratePerGram: 6200 }, totalInr: 21080, invoiceNumber: "DHG-2069" }, 50),
    pur("demo_pu_o9", { supplierId: "demo_s3", material: "gold", purpose: "order", orderId: "demo_o9", gold: { weightGrams: 9.6, purity: "18K", ratePerGram: 7560 }, totalInr: 72576, invoiceNumber: "DHG-2063" }, 85),
    pur("demo_pu_dp2", { supplierId: "demo_s2", material: "diamond", purpose: "stock", diamond: { carat: 2.01, ratePerCarat: 238144, kind: "certified", shape: "Round" }, totalInr: 478669, invoiceNumber: "HM-7731" }, 32),
  ];
  // The certified stone came off that last bill.
  for (const pk of diamondPackets) if (pk.id === "demo_dp2") pk.purchaseId = "demo_pu_dp2";

  const mv = (id: string, material: "gold" | "diamond", type: StockMovement["type"], bucket: string, quantity: number, daysBack: number, ref?: Partial<StockMovement>): StockMovement => ({
    id, material, type, purityOrQuality: bucket, quantity, createdBy: "demo_admin", createdAt: daysAgo(daysBack, 11), ...ref,
  });
  const stockMovements: StockMovement[] = [
    mv("demo_mv_g14", "gold", "purchase_in", "14K", 60, 140, { refType: "purchase", refId: "demo_pu_g14" }),
    mv("demo_mv_g14b", "gold", "purchase_in", "14K", 25, 45, { refType: "purchase", refId: "demo_pu_g14b" }),
    mv("demo_mv_g18", "gold", "purchase_in", "18K", 30, 130, { refType: "purchase", refId: "demo_pu_g18" }),
    mv("demo_mv_g10", "gold", "purchase_in", "10K", 20, 120, { refType: "purchase", refId: "demo_pu_g10" }),
    mv("demo_mv_dR", "diamond", "purchase_in", "Round", 12, 110, { refType: "purchase", refId: "demo_pu_dR" }),
    mv("demo_mv_o2in", "gold", "purchase_in", "14K", 3.4, 50, { refType: "purchase", refId: "demo_pu_o2" }),
    mv("demo_mv_o2use", "gold", "order_direct_use", "14K", 3.4, 50, { refType: "order", refId: "demo_o2" }),
    mv("demo_mv_o9in", "gold", "purchase_in", "18K", 9.6, 85, { refType: "purchase", refId: "demo_pu_o9" }),
    mv("demo_mv_o9use", "gold", "order_direct_use", "18K", 9.6, 85, { refType: "order", refId: "demo_o9" }),
  ];

  // What went to the factory for each order, and what the factory charged.
  const iss = (id: string, o: Partial<MaterialIssuance> & Pick<MaterialIssuance, "factoryId" | "orderId" | "material" | "purityOrQuality" | "quantityIssued" | "source">, daysBack: number, charge = 0): MaterialIssuance => ({
    id, issuedAt: daysAgo(daysBack, 12), issuedBy: "demo_admin", status: charge > 0 ? "closed" : "open",
    finishedPieces: [], makingCharges: { amountInr: charge, payments: [] }, ...o,
  });
  const materialIssuances: MaterialIssuance[] = [
    iss("demo_mi_o2g", { factoryId: "demo_f1", orderId: "demo_o2", material: "gold", purityOrQuality: "14K", quantityIssued: 3.37, source: "purchase", sourcePurchaseId: "demo_pu_o2" }, 50, 4600),
    iss("demo_mi_o2d", { factoryId: "demo_f1", orderId: "demo_o2", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 1.04, source: "stock" }, 50),
    iss("demo_mi_o5g", { factoryId: "demo_f1", orderId: "demo_o5", material: "gold", purityOrQuality: "14K", quantityIssued: 4.16, source: "stock" }, 48, 5300),
    iss("demo_mi_o5d", { factoryId: "demo_f1", orderId: "demo_o5", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 2.06, source: "stock" }, 48),
    iss("demo_mi_o9g", { factoryId: "demo_f1", orderId: "demo_o9", material: "gold", purityOrQuality: "18K", quantityIssued: 9.52, source: "purchase", sourcePurchaseId: "demo_pu_o9" }, 85, 10200),
    iss("demo_mi_o9d", { factoryId: "demo_f1", orderId: "demo_o9", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 2.84, source: "stock" }, 85),
    iss("demo_mi_o4g", { factoryId: "demo_f2", orderId: "demo_o4", material: "gold", purityOrQuality: "10K", quantityIssued: 2.84, source: "stock" }, 30, 1850),
    iss("demo_mi_o4d", { factoryId: "demo_f2", orderId: "demo_o4", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 0.44, source: "stock" }, 30),
    iss("demo_mi_o3g", { factoryId: "demo_f2", orderId: "demo_o3", material: "gold", purityOrQuality: "14K", quantityIssued: 3.08, source: "stock" }, 38, 3400),
    iss("demo_mi_o3d", { factoryId: "demo_f2", orderId: "demo_o3", material: "diamond", diamondKind: "loose", purityOrQuality: "Round", quantityIssued: 0.88, source: "stock" }, 38),
    iss("demo_mi_o11", { factoryId: "demo_f1", orderId: "demo_o11", material: "diamond", diamondKind: "certified", diamondPacketIds: ["demo_dp2"], purityOrQuality: "Round", quantityIssued: 2.01, source: "stock", finishDisposition: "used" }, 28),
    // Still at the factory — their cost so far shows on the card.
    iss("demo_mi_o1g", { factoryId: "demo_f1", orderId: "demo_o1", material: "gold", purityOrQuality: "14K", quantityIssued: 3.9, source: "stock" }, 14),
    iss("demo_mi_o6g", { factoryId: "demo_f2", orderId: "demo_o6", material: "gold", purityOrQuality: "14K", quantityIssued: 3.6, source: "stock" }, 18),
    iss("demo_mi_o10g", { factoryId: "demo_f1", orderId: "demo_o10", material: "gold", purityOrQuality: "18K", quantityIssued: 1.2, source: "stock" }, 22),
  ];
  // Each stock issue takes material out of the pool, on the day it went.
  for (const m of materialIssuances) {
    if (m.source !== "stock" || m.diamondKind === "certified") continue;
    stockMovements.push(mv(`demo_mv_${m.id}`, m.material, "issuance_out", m.purityOrQuality, m.quantityIssued,
      Math.round((Date.now() - +new Date(m.issuedAt)) / 86400000), { refType: "materialIssuance", refId: m.id }));
  }

  // Freight and insurance per parcel, and the business's running costs.
  const exp = (id: string, o: Partial<Expense> & Pick<Expense, "title" | "amount" | "category">, daysBack: number): Expense => ({
    id, employeeId: "demo_admin", currency: "INR", createdAt: daysAgo(daysBack, 16), ...o,
  });
  const expenses: Expense[] = [
    exp("demo_ex_f2", { title: "Freight — FedEx 7792 4410 8831", amount: 2400, category: "Shipping", lockerId: "demo_l1", orderIds: ["demo_o2"], shipmentRef: "FedEx 7792 4410 8831" }, 18),
    exp("demo_ex_f9", { title: "Freight — FedEx 7791 8820 4417", amount: 3200, category: "Shipping", lockerId: "demo_l1", orderIds: ["demo_o9"], shipmentRef: "FedEx 7791 8820 4417" }, 44),
    exp("demo_ex_i9", { title: "Insurance — FedEx 7791 8820 4417", amount: 1450, category: "Shipping", lockerId: "demo_l1", orderIds: ["demo_o9"], shipmentRef: "FedEx 7791 8820 4417" }, 44),
    exp("demo_ex_f5", { title: "Freight — DHL JD01 4455 9087", amount: 38, currency: "USD", category: "Shipping", lockerId: "demo_l3", orderIds: ["demo_o5"], shipmentRef: "DHL JD01 4455 9087" }, 4),
    exp("demo_ex_i5", { title: "Insurance — DHL JD01 4455 9087", amount: 22, currency: "USD", category: "Shipping", lockerId: "demo_l3", orderIds: ["demo_o5"], shipmentRef: "DHL JD01 4455 9087" }, 4),
    // The loose stone's parcel has no freight on record — the backlog tool
    // lists it, and this month's courier bill below can be attached to it.
    exp("demo_ex_bill", { title: "Malca-Amit — monthly bill", amount: 2100, category: "Other", lockerId: "demo_l1" }, 5),
    exp("demo_ex_sal", { title: "Salary — Nisha Patel", amount: 38000, category: "Salary", lockerId: "demo_l1", paidToEmployeeId: "demo_e1" }, 10),
    exp("demo_ex_rent", { title: "Office rent", amount: 22000, category: "Office", lockerId: "demo_l1" }, 9),
    exp("demo_ex_trv", { title: "Surat trip — supplier visit", amount: 12500, category: "Travel", lockerId: "demo_l2" }, 20),
    exp("demo_ex_com", { title: "Internet & phones", amount: 3200, category: "Communication", lockerId: "demo_l1" }, 15),
  ];
  for (const e of expenses) {
    if (!e.lockerId) continue;
    ledger.push({
      id: `demo_ltx_${e.id}`, lockerId: e.lockerId, type: "expense", amountInr: e.amount, currency: e.currency,
      category: `Expense — ${e.title}`, refType: "expense", refId: e.id, recordedBy: "demo_admin", createdAt: e.createdAt,
    });
  }

  // Ready stock carries no cost on the item: it is written separately, where
  // only the admin can read it (see seedDemoData).
  for (const r of readyStock) delete (r as { cost?: number }).cost;

  return {
    clients, suppliers, factories, lockers, users, orders, readyStock, diamondPackets,
    purchases, stockMovements, materialIssuances, expenses,
    clientReceipts: receipts, lockerTransactions: ledger,
  };
}

/** What each shelf piece cost, in dollars — the one made in-house is costed
 *  from its own build, so it has none here. */
export const DEMO_STOCK_COSTS: Record<string, number> = { demo_rs2: 520, demo_rs3: 355, demo_rs4: 1280 };

/** Rupee to the dollar over the last few months, each from its date on. */
export function demoRates(): { from: string; rate: number }[] {
  const day = (n: number) => daysAgo(n).slice(0, 10);
  return [{ from: day(150), rate: 82.9 }, { from: day(75), rate: 83.4 }, { from: day(30), rate: 84.2 }];
}

/** True once the sample is in — the button says "replace" rather than "load". */
export function hasDemoData(): boolean {
  return loadDb().clients.some(c => c.id.startsWith("demo_"));
}

/**
 * Write the sample in, replacing any earlier copy of it.
 *
 * Only rows whose id begins `demo_` are removed first, so anything entered
 * during the demo itself survives a reload of the sample.
 */
export function seedDemoData(): void {
  const data = buildDemoData();
  updateDb(d => {
    for (const [key, rows] of Object.entries(data)) {
      const col = key as keyof DB;
      const existing = (d[col] as unknown as { id: string }[]) ?? [];
      const kept = existing.filter(r => !r.id?.startsWith("demo_"));
      (d as unknown as Record<string, unknown>)[col] = [...kept, ...(rows as { id: string }[])];
    }
    // Through the same doors the app uses: the admin-only record once its
    // rules are live, the old places until then.
    writeFxTable(d, demoRates());
    for (const [itemId, cost] of Object.entries(DEMO_STOCK_COSTS)) writeStockCost(d, itemId, cost);
  });
}

/** Take the sample back out, leaving anything added during the demo. */
export function clearDemoData(): void {
  const keys = Object.keys(buildDemoData()) as (keyof DB)[];
  updateDb(d => {
    for (const col of keys) {
      const existing = (d[col] as unknown as { id: string }[]) ?? [];
      (d as unknown as Record<string, unknown>)[col] = existing.filter(r => !r.id?.startsWith("demo_"));
    }
    d.adminRecords = (d.adminRecords ?? []).filter(r => !(r.kind === "stockCost" && r.itemId.startsWith("demo_")));
  });
}
