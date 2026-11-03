// The API's own rules (src/logic.ts), checked without a database: npm test (builds first).
const L = require("../lib/logic.js");
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m, x); };
const throws = (f, code) => { try { f(); return false; } catch (e) { return e instanceof L.ApiError && (!code || e.code === code); } };
const play = u => u + ".web.mp4";

const docs = [
  { id: "a", name: "Solitaire Ring", jewelleryType: "Ring", metal: "Yellow Gold", productKarats: "18K", grossWeight: 4.2, netWeight: 3.9, diamondWeight: 1.01, diamondType: "Natural", price: 2000, quantity: 2, images: ["https://x/a1.jpg", "data:bad"], video: "https://f/v0/b/b/o/v.mov?alt=media", sku: "SR-1", location: "US", createdAt: "2026-10-01T00:00:00Z", cost: 900, notes: "secret", history: [{ text: "x" }] },
  { id: "b", name: "Tennis Bracelet", jewelleryType: "Bracelet", metal: "White Gold", productKarats: "14K", grossWeight: 12, diamondWeight: 3, diamondType: "Lab Grown", price: 3500, quantity: 1, images: [], location: "India", createdAt: "2026-10-05T00:00:00Z", companyId: "co2" },
  { id: "c", name: "Plain Band", jewelleryType: "Ring", metal: "Platinum", grossWeight: 6, price: 800, quantity: 0, images: ["https://x/c.jpg"], location: "US", createdAt: "2026-09-01T00:00:00Z" },
  { id: "d", name: "Drop Earrings", jewelleryType: "Earrings", metal: "Rose Gold", productKarats: "18K", grossWeight: 3, diamondWeight: 0.5, diamondType: "Natural", price: 0, quantity: 3, images: [], location: "Hong Kong", createdAt: "2026-10-10T00:00:00Z" },
];
const design = { designNumber: "LR-534", productSize: "7", productColor: "Yellow", diamondShape: "Round", actualDiamondPcs: 1, rhodium: "No Rhodium", certificate: true, cad3dmUrl: "https://x/m.3dm" };
const all = (rules = {}) => docs.filter(d => L.inScope(d, rules)).map(d => L.toProduct(d, d.id === "a" ? design : undefined, rules, play));

// A product: every detail, never the cost
const p = all()[0];
ok(p.price === 2000 && p.currency === "USD" && p.karat === "18K" && p.grossWeightG === 4.2 && p.diamondCt === 1.01, "a piece's own details");
ok(p.designNumber === "LR-534" && p.size === "7" && p.metalColor === "Yellow" && p.diamondShape === "Round" && p.diamondPieces === 1 && p.certified === true, "the order's design details");
ok(p.model3d === null && all({ share3d: true })[0].model3d === "https://x/m.3dm", "the 3D CAD file only on a key that shares it");
ok(!("cost" in p) && !("notes" in p) && !("history" in p) && !JSON.stringify(p).includes("secret"), "no cost, notes or history");
ok(p.images.length === 1 && p.image === "https://x/a1.jpg", "only real image addresses");
ok(p.video && p.video.url.endsWith("v.mov?alt=media") && p.video.playable.endsWith(".web.mp4"), "video + its playable copy");
ok(all()[3].price === null, "a piece with no price shows null");

// Price per key
ok(all({ price: { markupPct: 10 } })[0].price === 2200, "markup +10%");
ok(all({ price: { markupPct: -5 } })[1].price === 3325, "markdown -5%");
ok(all({ price: { show: false } }).every(x => x.price === null), "price hidden");

// Scope per key
ok(all({ scope: { types: ["ring"] } }).map(x => x.id).join() === "a,c", "key limited to rings (any case)");
ok(all({ scope: { offices: ["US"], metals: ["Platinum"] } }).map(x => x.id).join() === "c", "key limited by office + metal");
ok(all({ scope: { companies: ["co2"] } }).map(x => x.id).join() === "b", "key limited to a company");
ok(all({ scope: { companies: ["main"] } }).length === 3, "the first company = unset companyId");

// List: in stock only by default, search, filters, sort, pages, fields
const list = (params, rules = {}) => L.listProducts(all(rules), L.parseQuery(params, rules.price?.show !== false));
ok(list({}).meta.total === 3 && !list({}).data.some(x => x.id === "c"), "sold out left out");
ok(list({ includeSoldOut: "true" }).meta.total === 4, "includeSoldOut=true");
ok(list({ q: "ring 18k" }).data.map(x => x.id).join() === "a", "search: every word must match");
ok(list({ q: "lr-534" }).data.map(x => x.id).join() === "a", "search finds the design number");
ok(list({ category: "Ring,Earrings" }).meta.total === 2, "category list");
ok(list({ minPrice: "1000", maxPrice: "3000" }).data.map(x => x.id).join() === "a", "price range");
ok(list({ minCt: "1" }).meta.total === 2, "carat range");
ok(list({ hasVideo: "true" }).data.map(x => x.id).join() === "a", "hasVideo");
ok(list({ sort: "price_asc" }).data.map(x => x.id).join() === "a,b,d", "price low to high, no price last");
ok(list({ sort: "price_desc" }).data.map(x => x.id).join() === "b,a,d", "price high to low, no price last");
ok(list({ sort: "newest" }).data.map(x => x.id).join() === "d,b,a", "newest first (default)");
const pg = list({ limit: "2", page: "2" });
ok(pg.data.length === 1 && pg.meta.totalPages === 2 && pg.meta.hasMore === false && pg.meta.page === 2, "pages");
ok(JSON.stringify(Object.keys(list({ fields: "name,price" }).data[0]).sort()) === JSON.stringify(["id", "name", "price"]), "fields=name,price (+id)");
ok(list({ colour: "x" }).meta.ignoredParameters?.includes("colour"), "unknown parameter named back");
ok(list({ updatedSince: "2026-10-04" }).data.map(x => x.id).sort().join() === "b,d", "updatedSince");
ok(list({ ids: "b,c", includeSoldOut: "1" }).meta.total === 2, "ids");

// Wrong parameters are refused with the reason
ok(throws(() => L.parseQuery({ limit: "500" }, true), "bad_parameter"), "limit over 100 refused");
ok(throws(() => L.parseQuery({ sort: "random" }, true), "bad_parameter"), "unknown sort refused");
ok(throws(() => L.parseQuery({ minPrice: "abc" }, true), "bad_parameter"), "non-number refused");
ok(throws(() => L.parseQuery({ minPrice: "5", maxPrice: "1" }, true), "bad_parameter"), "min more than max refused");
ok(throws(() => L.parseQuery({ fields: "cost" }, true), "bad_parameter"), "fields=cost refused");
ok(throws(() => L.parseQuery({ sort: "price_asc" }, false), "price_not_shared"), "price sort on a no-price key refused");

// Filter counts: a filter's own choices don't narrow its own list
const f = L.facets(all(), L.parseQuery({ category: "Ring" }, true));
ok(f.total === 1 && f.categories.find(c => c.value === "Bracelet")?.count === 1 && f.metals.length === 1, "facets: disjunctive counts", JSON.stringify(f.categories));
ok(f.price.min === 2000 && f.price.max === 2000, "facets: price range of what is shown");

// Who is calling
ok(L.clientIp("6.6.6.6, 203.0.113.5", false) === "203.0.113.5" && L.clientIp("203.0.113.5, 76.76.21.1", true) === "203.0.113.5" && L.clientIp(undefined, false, "::ffff:1.2.3.4") === "1.2.3.4" && L.clientIp("<script>", false) === "", "caller address: the last hop Google added; through our proxy, the one before");
ok(L.hostOf("https://www.shop.example.com/x") === "shop.example.com" && L.hostOf("nonsense") === "", "website from Origin/Referer");
ok(L.originAllowed("shop.example.com", ["*.example.com"]) && L.originAllowed("example.com", ["https://example.com/"]) && !L.originAllowed("evil.com", ["example.com"]) && L.originAllowed("", ["example.com"]), "allowed websites");
ok(L.deviceOf("curl/8.4.0").label === "Server · curl", "curl = server");
ok(L.deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1").label === "Mobile · Safari · iOS", "iPhone Safari");
ok(L.deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0").label === "Desktop · Edge · Windows", "Windows Edge");
ok(L.deviceOf("Googlebot/2.1").kind === "Bot", "bot");
ok(!L.mapKey("shop.example.com").includes(".") && L.mapKey("") === "(none)", "map keys safe for the database");
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
