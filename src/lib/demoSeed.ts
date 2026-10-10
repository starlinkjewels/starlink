import {
  loadDb, updateDb, buildTimelineSteps,
  type DB, type Order, type TimelineEntry, type AdvancePayment,
  type Client, type Supplier, type Factory, type Locker, type User,
  type ReadyStockItem, type DiamondPacket,
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

function advance(id: string, amount: number, daysBack: number, note = "Advance received"): AdvancePayment {
  return { id: `demo_adv_${id}`, amount, note, recordedBy: "demo_admin", createdAt: daysAgo(daysBack) };
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
      assignedEmployeeId: "demo_e2", advances: [advance("1", 500, 16)],
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
      advances: [advance("2a", 700, 60), advance("2b", 825, 14, "Balance on delivery")],
    }),
    order({
      id: "demo_o3", orderNumber: "SLJ-2026-1068", clientId: "", forReadyStock: true,
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
      assignedEmployeeId: "demo_e2", advances: [advance("4", 300, 30)],
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
      advances: [advance("5", 900, 52)],
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
      assignedEmployeeId: "demo_e1", advances: [advance("7", 400, 6)],
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
      advances: [advance("9a", 1600, 90), advance("9b", 1725, 40, "Balance before dispatch")],
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
      amount: 4100, diamondWeight: 2.01, metalWeight: 0, diamondType: "Lab Grown",
      createdAt: daysAgo(30), timeline: timeline(3, false, 30, true), expectedDelivery: daysAhead(-8),
      courierName: "Malca-Amit", trackingNumber: "MA-5541-99", dispatchedAt: daysAgo(6),
      advances: [advance("11", 4100, 28, "Paid in full")],
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

  return { clients, suppliers, factories, lockers, users, orders, readyStock, diamondPackets };
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
  });
}
