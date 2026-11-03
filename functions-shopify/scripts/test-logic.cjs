// The Shopify rules (src/logic.ts), checked without a database: npm test.
const L = require("../lib/logic.js");
const { createHmac } = require("crypto");
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m, x); };

// Store addresses
ok(L.cleanShop("Acme-Jewels.myshopify.com") === "acme-jewels.myshopify.com", "store address, any case");
ok(L.cleanShop("https://acme-jewels.myshopify.com/admin") === "acme-jewels.myshopify.com", "store address from a link");
ok(L.cleanShop("acme-jewels") === "acme-jewels.myshopify.com", "store handle alone");
ok(L.cleanShop("evil.com") === null && L.cleanShop("a.myshopify.com.evil.com") === null && L.cleanShop("-x.myshopify.com") === null, "anything else refused");

// Signatures
const body = Buffer.from('{"id":1,"admin_graphql_api_id":"gid://shopify/Order/1"}');
const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
ok(L.webhookSigned(body, sig, "s3cret"), "a message signed with the store's secret is accepted");
ok(!L.webhookSigned(body, sig, "other"), "another secret: refused");
ok(!L.webhookSigned(Buffer.from(body.toString() + " "), sig, "s3cret"), "a changed body: refused");
ok(!L.webhookSigned(body, undefined, "s3cret") && !L.webhookSigned(body, "x", "s3cret"), "no / bad signature: refused");

// Which orders come in
const base = { id: "gid://shopify/Order/1", legacyId: "1", name: "#1001", createdAt: "", updatedAt: "", test: false, tags: [], currency: "USD", lines: [] };
ok(L.importProblem({ ...base, financialStatus: "PAID" }, {}) === null, "paid: comes in");
ok(/Not paid/.test(L.importProblem({ ...base, financialStatus: "PENDING" }, {})), "not paid: waits (default)");
ok(L.importProblem({ ...base, financialStatus: "PENDING" }, { importWhen: "any" }) === null, "any order, when chosen");
ok(L.importProblem({ ...base, financialStatus: "PAID", test: true }, {}) === "A test order", "test orders left out");
ok(/Cancelled/.test(L.importProblem({ ...base, financialStatus: "PAID", cancelledAt: "2026-11-03" }, {})), "cancelled: left out");

// A line on our order
const types = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
const metals = ["Yellow Gold", "White Gold (Palladium Alloy)", "White Gold (Silver Alloy)", "Rose Gold", "Platinum", "Silver", "Titanium"];
const noK = ["Platinum", "Silver", "Titanium"];
const line = { id: "gid://shopify/LineItem/77", title: "Oval Halo Engagement Ring", variantTitle: "14K / Rose Gold / 7", sku: "LR-534", quantity: 1, currentQuantity: 1,
  options: [{ name: "Metal", value: "14K Rose Gold" }, { name: "Ring Size", value: "7" }, { name: "Diamond", value: "Lab Grown" }],
  properties: [{ key: "Engraving", value: "Forever" }, { key: "_hidden", value: "x" }], unitPrice: 1200, image: "https://cdn.shopify.com/a.jpg", productType: "Rings", productTags: [] };
const m = L.mapLine(line, { name: "#1001", note: "Gift wrap", currency: "USD" }, {}, types, metals, noK);
ok(m.jewelleryType === "Ring" && m.metal === "Rose Gold" && m.productKarats === "14K" && m.productSize === "7" && m.diamondType === "Lab Grown" && m.productColor === "Rose", "type, metal, karat, size, stone, colour", JSON.stringify(m));
ok(m.designNumber === "LR-534", "SKU → design number");
ok(/Engraving: Forever/.test(m.instructions) && !/_hidden/.test(m.instructions) && /Order note: Gift wrap/.test(m.instructions) && /Shopify #1001/.test(m.instructions), "what the customer wrote goes to the instructions");
ok(m.amount === 0 && m.review.includes("price"), "price left for the approval (default)");
const p = L.mapLine(line, { name: "#1001", currency: "USD" }, { priceMode: "percent", pricePct: 60 }, types, metals, noK);
ok(p.amount === 720 && !p.review.includes("price"), "price as 60% of Shopify's (USD store)");
const pe = L.mapLine(line, { name: "#1001", currency: "EUR" }, { priceMode: "percent", pricePct: 60 }, types, metals, noK);
ok(pe.amount === 0 && pe.review.includes("price"), "a non-USD store: price left for the approval");
const plat = L.mapLine({ ...line, title: "Platinum Band", options: [{ name: "Metal", value: "Platinum" }], variantTitle: null, productType: "" }, { name: "#2", currency: "USD" }, {}, types, metals, noK);
ok(plat.metal === "Platinum" && !plat.productKarats && !plat.review.includes("karat") && plat.jewelleryType === "Ring", "platinum: no karat needed; 'band' is a ring");
const unknown = L.mapLine({ ...line, title: "Mystery", options: [], variantTitle: null, productType: "", sku: null }, { name: "#3", currency: "USD" }, {}, types, metals, noK);
ok(unknown.review.includes("type") && unknown.review.includes("metal") && types.includes(unknown.jewelleryType) && metals.includes(unknown.metal), "nothing found: our own list's values, marked for review");
const custom = L.mapLine({ ...line, title: "Charm", productType: "Charms" }, { name: "#4", currency: "USD" }, { typeRules: [{ word: "charm", type: "Pendant" }] }, types, metals, noK);
ok(custom.jewelleryType === "Pendant", "the store's own word rule");
const notOurs = L.mapLine({ ...line, title: "Charm", productType: "Charms" }, { name: "#4", currency: "USD" }, { typeRules: [{ word: "charm", type: "Anklet" }] }, types, metals, noK);
ok(types.includes(notOurs.jewelleryType) && notOurs.review.includes("type"), "a rule naming a type we don't have is not used");
ok(L.mapLine({ ...line, currentQuantity: 3 }, { name: "#5", currency: "USD" }, {}, types, metals, noK).quantity === 3, "quantity after edits");

// Stages: as the app
ok(L.newOrderSteps(undefined).join() === "Order Submitted,Order Approved,CAD Designing,In Production,Final Approval,Dispatch,Delivered", "built-in stages (no certificate)");
const own = ["CAD Designing", "Setting", "In Production", "Certification", "Final Approval"];
ok(L.newOrderSteps(own).join() === "Order Submitted,Order Approved,CAD Designing,Setting,In Production,Final Approval,Dispatch,Delivered", "the admin's own stages");
ok(L.newOrderSteps(["In Production", "Final Approval"]).includes("CAD Designing"), "an unusable list: the built-in stages");

// Back to Shopify
ok(L.shopifyCarrier("fedex") === "FedEx" && L.shopifyCarrier("DHL") === "DHL Express" && L.shopifyCarrier("blue dart") === "Blue Dart" && L.shopifyCarrier("Sequel Logistics") === "Sequel Logistics" && L.shopifyCarrier("") === undefined, "carrier names as Shopify spells them");
ok(L.stageTag("Starlink", "In Production") === "Starlink: In Production", "stage tag");
ok(L.legacyOf("gid://shopify/Order/123") === "123", "id from a gid");
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
// Whole words only
{
  const types = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
  const metals = ["Yellow Gold", "White Gold (Palladium Alloy)", "Rose Gold", "Platinum", "Silver"];
  const L2 = require("../lib/logic.js");
  const base = { id: "x", title: "Diamond Stud Earrings", variantTitle: "18K White Gold", sku: null, quantity: 2, currentQuantity: 2, options: [{ name: "Metal", value: "18K White Gold" }], properties: [], productType: "Earrings", productTags: [] };
  const m = L2.mapLine(base, { name: "#1", currency: "USD" }, {}, types, metals, []);
  console.log((m.jewelleryType === "Earrings" && m.metal === "White Gold (Palladium Alloy)" ? "  ok   " : "  FAIL ") + "'ring' never matches inside 'Earrings'", m.jewelleryType, m.metal);
  const r = L2.mapLine({ ...base, title: "Solitaire Rings", productType: "" , variantTitle: "Rose Gold", options: [] }, { name: "#1", currency: "USD" }, {}, types, metals, []);
  console.log((r.jewelleryType === "Ring" && r.metal === "Rose Gold" ? "  ok   " : "  FAIL ") + "plural 'Rings' is a ring", r.jewelleryType);
}
