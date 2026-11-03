// Etsy's rules (src/etsyLogic.ts), checked without a database: npm test.
const E = require("../lib/etsyLogic.js");
const L = require("../lib/shared/logic.js");
const { createHash, createHmac, randomBytes } = require("crypto");
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m, x); };

// Sign in with Etsy (PKCE)
const p = E.pkce();
ok(/^[A-Za-z0-9._~-]{43,128}$/.test(p.verifier), "verifier: 43–128 allowed characters", p.verifier.length);
ok(p.challenge === createHash("sha256").update(p.verifier).digest("base64url") && E.challengeOf(p.verifier) === p.challenge, "challenge = S256 of the verifier");
ok(E.pkce().verifier !== p.verifier, "a new verifier each time");
const u = new URL(E.authorizeUrl("abc123keystring", "https://x.example/etsyCallback", "st4te", p.challenge));
ok(u.origin + u.pathname === "https://www.etsy.com/oauth/connect", "approval page on etsy.com");
ok(u.searchParams.get("response_type") === "code" && u.searchParams.get("client_id") === "abc123keystring" && u.searchParams.get("redirect_uri") === "https://x.example/etsyCallback"
  && u.searchParams.get("state") === "st4te" && u.searchParams.get("code_challenge_method") === "S256" && u.searchParams.get("code_challenge") === p.challenge, "every part of the link");
ok(u.searchParams.get("scope") === "transactions_r transactions_w listings_r shops_r", "only the scopes we need");
ok(E.userOfToken("12345678.abcDEF") === "12345678" && E.userOfToken("nope") === "", "token owner from its prefix");

// Webhook signatures (Standard Webhooks)
const key = randomBytes(24), secret = "whsec_" + key.toString("base64");
const body = Buffer.from('{"event_type":"order.paid","resource_url":"https://api.etsy.com/v3/application/shops/111/receipts/999","shop_id":111}');
const now = Date.now(), ts = String(Math.floor(now / 1000)), id = "msg_1";
const sign = (k, b, i = id, t = ts) => "v1," + createHmac("sha256", k).update(`${i}.${t}.`).update(b).digest("base64");
ok(E.etsySigned(body, { id, timestamp: ts, signature: sign(key, body) }, secret, now), "signed with the shop's secret: accepted");
ok(E.etsySigned(body, { id, timestamp: ts, signature: "v1,AAAA " + sign(key, body) }, secret, now), "one of several signatures matches: accepted");
ok(!E.etsySigned(body, { id, timestamp: ts, signature: sign(randomBytes(24), body) }, secret, now), "another secret: refused");
ok(!E.etsySigned(Buffer.from(body.toString() + " "), { id, timestamp: ts, signature: sign(key, body) }, secret, now), "a changed body: refused");
ok(!E.etsySigned(body, { id: "msg_2", timestamp: ts, signature: sign(key, body) }, secret, now), "another message id: refused");
const old = String(Math.floor(now / 1000) - 400);
ok(!E.etsySigned(body, { id, timestamp: old, signature: sign(key, body, id, old) }, secret, now), "older than 5 minutes: refused (a replay)");
ok(!E.etsySigned(body, { id, timestamp: ts }, secret, now) && !E.etsySigned(body, { id, timestamp: ts, signature: sign(key, body) }, "", now), "no signature / no secret: refused");
ok(E.receiptOfResource("https://api.etsy.com/v3/application/shops/111/receipts/999", "111") === "999", "the receipt the message names");
ok(E.receiptOfResource("https://api.etsy.com/v3/application/shops/222/receipts/999", "111") === null, "another shop's receipt: ignored");

// An Etsy order in the shared shape
const r = {
  receipt_id: 3456789012, status: "Paid", is_paid: true, is_shipped: false, create_timestamp: 1793000000, update_timestamp: 1793000600,
  name: "Asha Patel", first_line: "12 Rose St", second_line: null, city: "Leicester", state: "", zip: "LE1 1AA", country_iso: "GB",
  message_from_buyer: "Please gift wrap", is_gift: true, gift_message: "Happy birthday", grandtotal: { amount: 45000, divisor: 100, currency_code: "GBP" },
  transactions: [
    { transaction_id: 11, listing_id: 5, title: "Oval Halo Engagement Ring", sku: "LR-534", quantity: 1, price: { amount: 42000, divisor: 100, currency_code: "GBP" },
      variations: [{ property_id: 200, formatted_name: "Metal", formatted_value: "14K Rose Gold" }, { property_id: 100, formatted_name: "Ring size", formatted_value: "7" },
        { property_id: 54, formatted_name: "Personalization", formatted_value: "Forever A+R" }] },
    { transaction_id: 12, title: "Digital guide", quantity: 1, is_digital: true },
  ],
};
const o = E.toShopOrder(r, () => "https://i.etsystatic.com/a.jpg", "GBP");
ok(o.name === "#3456789012" && o.financialStatus === "PAID" && !o.cancelledAt && o.currency === "GBP", "order name, paid, currency");
ok(o.lines.length === 1 && o.lines[0].id === "11", "digital items left out");
const l = o.lines[0];
ok(l.unitPrice === 420 && l.unfulfilled === 1 && l.image === "https://i.etsystatic.com/a.jpg", "price from amount/divisor, not shipped, photo");
ok(l.variantTitle === "14K Rose Gold / 7" && l.options.length === 2 && l.properties[0].value === "Forever A+R", "choices as options, personalisation apart");
ok(/Please gift wrap/.test(o.note) && /Happy birthday/.test(o.note), "buyer's message and gift note");
ok(o.shipTo.city === "Leicester" && o.shipTo.country === "GB" && o.customer.name === "Asha Patel", "where it ships");
ok(E.toShopOrder({ ...r, status: "Canceled" }, () => null).cancelledAt, "cancelled");
ok(E.toShopOrder({ ...r, status: "Fully Refunded" }, () => null).cancelledAt, "fully refunded = cancelled");
ok(E.toShopOrder({ ...r, is_shipped: true }, () => null).lines[0].unfulfilled === 0, "shipped: nothing left to make");
ok(E.toShopOrder({ ...r, is_paid: false, status: "Payment Processing" }, () => null).financialStatus === "PENDING", "payment processing = not paid yet");

// The shared rules read it like a Shopify order
const types = ["Ring", "Ring + Band", "Pendant", "Necklace", "Bracelet", "Earrings", "Custom"];
const metals = ["Yellow Gold", "White Gold (Palladium Alloy)", "White Gold (Silver Alloy)", "Rose Gold", "Platinum", "Silver", "Titanium"];
const m = L.mapLine(l, o, {}, types, metals, ["Platinum", "Silver", "Titanium"]);
ok(m.jewelleryType === "Ring" && m.metal === "Rose Gold" && m.productKarats === "14K" && m.productSize === "7", "type, metal, karat, size", JSON.stringify(m));
ok(/Forever A\+R/.test(m.instructions) && /gift wrap/.test(m.instructions), "personalisation and note go to the instructions");
ok(L.importProblem(o, L.rulesOf({}), null) === null, "a paid order comes in");
ok(/Not paid/.test(L.importProblem(E.toShopOrder({ ...r, is_paid: false, status: "Payment Processing" }, () => null), L.rulesOf({}), null) ?? ""), "not paid: waits");

// Carriers
const names = ["Royal Mail", "DHL", "FedEx", "UPS", "Parcelforce"];
ok(E.etsyCarrier("royal mail", names) === "Royal Mail" && E.etsyCarrier("DHL Express", names) === "DHL", "our courier → Etsy's name");
ok(E.etsyCarrier("BlueDart", names) === "other" && E.etsyCarrier("", names) === "other", "unknown → other");
ok(E.etsyCarrier("Royal", ["Royal Mail", "Royal Mail Tracked"]) === "other", "two possible carriers: none guessed (other)");
ok(E.etsyCarrier("DHL", ["-", "DHL"]) === "DHL" && E.etsyCarrier("UP", names) === "other", "nameless entries ignored; too-short names don't match");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
