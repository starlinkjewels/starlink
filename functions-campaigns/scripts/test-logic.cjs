// The campaign rules, checked without a database or a mailbox: npm test.
const E = require("../lib/shared/campaignEmail.js");
const W = require("../lib/write.js");
const S = require("../lib/send.js");
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m, x); };

// ── Nothing unsafe gets into an email
const evil = E.cleanDesign({
  theme: { brand: "red; background:url(javascript:x)", page: "#fff", ink: "#123456", font: "comic" },
  blocks: [
    { type: "heading", text: "<script>alert(1)</script>Hello" },
    { type: "text", text: "Click [here](javascript:alert(1)) or [our site](https://example.com/a?b=1&c=2) **now**" },
    { type: "image", src: "http://insecure.example/a.jpg", alt: "x" },
    { type: "image", src: "data:image/png;base64,AAAA", alt: "y" },
    { type: "button", label: "Go", href: "javascript:alert(1)" },
    { type: "iframe", src: "https://evil" },
    { type: "products", items: [{ title: "<b>Ring</b>", src: "https://cdn.example/r.jpg", href: "vbscript:x" }] },
  ],
});
ok(evil.theme.brand === E.DEFAULT_THEME.brand && evil.theme.font === "sans" && evil.theme.page === E.DEFAULT_THEME.page, "a colour that isn't #hex, a font not on the list: the defaults");
ok(!evil.blocks.some(b => b.type === "iframe"), "an unknown block (iframe) is dropped");
ok(evil.blocks.filter(b => b.type === "image").every(b => b.src === ""), "http and data: pictures dropped (https only)");
ok(evil.blocks.find(b => b.type === "button").href === "", "a javascript: button link dropped");
ok(evil.blocks.find(b => b.type === "products").items[0].href === undefined, "a vbscript: card link dropped");
const r = E.renderCampaign(evil, { brandName: "Starlink <Jewels>", subject: "Hi", logoUrl: "https://app.example/logo.png", unsubscribeUrl: "https://x.example/u?t=1" });
ok(!/<script/i.test(r.html) && /&lt;script&gt;/.test(r.html), "words are escaped — no <script> in the email");
ok(!/javascript:/i.test(r.html) && !/vbscript:/i.test(r.html), "no javascript: / vbscript: anywhere");
ok(/href="https:\/\/example.com\/a\?b=1&amp;c=2"/.test(r.html), "a real link kept (its & written safely)");
ok(/<strong>now<\/strong>/.test(r.html), "**bold** becomes bold");
ok(/Starlink &lt;Jewels&gt;/.test(r.html), "the sender's name is escaped too");
ok(/Unsubscribe<\/a>/.test(r.html) && /Unsubscribe: https:\/\/x.example\/u\?t=1/.test(r.text), "the unsubscribe link in the email and in its text part");
ok(r.emptyLinks === 1, "the button with no link is counted (blocks the send)");
const probs = E.designProblems(evil, "Hi", r);
ok(probs.some(p => p.level === "stop" && /no link/.test(p.text)) && probs.some(p => p.level === "stop" && /no picture/.test(p.text)), "checks stop the send: a button without a link, an image without a picture");

// ── Merge fields
ok(E.fillMerge("Dear {{first_name|there}}, from {{company}}", { first_name: "Ravi", company: "Mehta" }) === "Dear Ravi, from Mehta", "{{first_name}} and {{company}} filled");
ok(E.fillMerge("Dear {{first_name|there}},", {}) === "Dear there,", "an empty one takes its fallback");
const m = E.renderCampaign({ v: 1, theme: E.DEFAULT_THEME, blocks: [{ id: "a", type: "text", text: "Hi {{name}}" }] }, { brandName: "B", subject: "For {{first_name}}", vars: { name: "<img src=x onerror=alert(1)>" } });
ok(!/<img src=x/.test(m.html) && /&lt;img src=x/.test(m.html), "a person's name with HTML in it is escaped");
ok(/<title>For <\/title>/.test(m.html), "a field with no value and no fallback: empty");

// ── Layout an email program reads
const g = E.renderCampaign({ v: 1, theme: E.DEFAULT_THEME, blocks: [
  { id: "h", type: "heading", text: "New collection" },
  { id: "p", type: "products", columns: 2, items: [{ title: "Ring", src: "https://c.example/1.jpg" }, { title: "Pendant", src: "https://c.example/2.jpg" }, { title: "Studs", src: "https://c.example/3.jpg" }] },
  { id: "b", type: "button", label: "See more", href: "https://app.example/catalog" },
] }, { brandName: "B", subject: "S", preheader: "A first look at our new rings" });
ok(/role="presentation"/.test(g.html) && /lang="en"/.test(g.html) && /class="stack"/.test(g.html) && /max-width:620px/.test(g.html), "tables, lang, and phone stacking");
ok(/A first look at our new rings/.test(g.html) && /display:none/.test(g.html), "the hidden preview line");
ok(/<!--\[if mso\]>/.test(g.html), "an Outlook frame");
ok((g.html.match(/<img /g) || []).length === 3 && /width="260"/.test(g.html), "3 cards, two to a row (260 px each)");
ok(g.bytes < E.GMAIL_CLIP_BYTES && !g.clipped, "well under Gmail's 102 KB", `${g.bytes} bytes`);
ok(/See more: https:\/\/app.example\/catalog/.test(g.text) && /- Ring/.test(g.text), "a plain-text part with the links");
ok(E.designKey("S", "P", g && { theme: E.DEFAULT_THEME, blocks: [{ id: "h", type: "heading", text: "x" }] }) === E.designKey(" S ", "P ", { theme: E.DEFAULT_THEME, blocks: [{ id: "h", type: "heading", text: "x" }] }), "the 'exact email' key ignores spaces around the subject");
ok(E.designKey("S", "P", { blocks: [{ id: "h", type: "heading", text: "x" }] }) !== E.designKey("S", "P", { blocks: [{ id: "h", type: "heading", text: "y" }] }), "…and changes when a word changes (a new test is needed)");

// ── The AI: blocks only, pictures only from the pieces given
const pieces = [{ title: "Oval Halo Ring", sub: "14K · 1.2 ct", src: "https://cdn.example/ring.jpg" }, { title: "Tennis Bracelet", src: "https://cdn.example/b.jpg" }];
const ai = W.toDesign(W.jsonOf('Here you go:\n```json\n{"subjects":["New rings for {{company}}","Fresh designs"],"preheader":"Our new collection","blocks":[{"type":"heading","text":"Hello {{first_name|there}}"},{"type":"image","piece":1,"alt":"ring"},{"type":"image","src":"https://evil.example/x.jpg"},{"type":"products","items":[{"piece":2},{"piece":9}]},{"type":"button","label":"Order","href":""},{"type":"script","text":"x"}]}\n```'), pieces);
ok(ai.subjects.length === 2 && ai.preheader === "Our new collection", "subjects and the preview line read from the answer (even inside ``` fences)");
const imgs = ai.design.blocks.filter(b => b.type === "image");
ok(imgs.length === 1 && imgs[0].src === "https://cdn.example/ring.jpg", "an image: only the picked piece's picture — an address the AI made up is dropped");
const prod = ai.design.blocks.find(b => b.type === "products");
ok(prod && prod.items.length === 1 && prod.items[0].title === "Tennis Bracelet", "cards: only real pieces (number 9 doesn't exist → left out)");
ok(!ai.design.blocks.some(b => b.type === "button"), "a button with no real link is dropped");
ok(!ai.design.blocks.some(b => b.type === "script"), "an unknown block from the AI is dropped");
let threw = false; try { W.toDesign({ subjects: [], blocks: [] }, []); } catch { threw = true; }
ok(threw, "an answer with no email in it: an error, never an empty email");

// ── Gmail's answers
const c = S.classify;
ok(c({ responseCode: 550, response: "550 5.4.5 Daily user sending limit exceeded" }).quota === true, "the day's limit: wait for tomorrow (nothing sent)");
ok(c({ responseCode: 421, response: "421 4.7.28 Our system has detected an unusual rate" }).pauseAll === true, "slow down (4.7.28): the campaign waits");
ok(c({ code: "EAUTH", responseCode: 535 }).pauseAll === true, "a refused password: the campaign stops");
const b = c({ responseCode: 550, response: "550 5.1.1 The email account that you tried to reach does not exist" });
ok(b.retry === false && b.bounce === true, "no such address: a bounce (kept off every list)");
ok(c({ code: "ECONNREFUSED", command: "CONN" }).retry === true && c({ code: "ECONNREFUSED" }).pauseAll === true, "couldn't reach the mailbox at all: nothing sent, everything waits");
const u = c({ code: "ECONNRESET", command: "CONN" });
ok(u.retry === false && u.unsure === true, "the connection broke (nodemailer says CONN at any stage): 'unsure' — never sent again by itself");
ok(c({ code: "ETIMEDOUT", command: "CONN" }).unsure === true, "a time-out while sending: 'unsure' too");
const pol = c({ responseCode: 550, response: "550 5.7.1 [x] Our system has detected that this message is likely unsolicited mail" });
ok(pol.retry === true && pol.pauseAll === true, "5.7.x (Gmail refusing the sender): nothing sent, EVERY campaign waits");
const odd = c({ responseCode: 550, response: "550 5.1.1 user unknown at host 10.4.7.25" });
ok(odd.bounce === true && !odd.pauseAll, "a 5xx with '4.7.' inside a number is still a bounce, not a slow-down");
// AI links: only addresses the admin gave
const L = W.toDesign({ subjects: ["S"], blocks: [{ type: "text", text: "See [our site](https://evil.example/x) and [catalog](https://ours.example/cat)" }, { type: "button", label: "Phish", href: "https://evil.example/login" }, { type: "button", label: "Catalog", href: "https://ours.example/cat" }] }, [], "Show our catalog https://ours.example/cat.");
const lt = L.design.blocks.find(b => b.type === "text").text;
ok(!/evil/.test(lt) && /\[catalog\]\(https:\/\/ours.example\/cat\)/.test(lt), "a text link the admin never gave becomes plain words; one from the brief stays");
ok(L.design.blocks.filter(b => b.type === "button").map(b => b.label).join() === "Catalog", "a button to an address nobody gave is dropped");
// A person's name can't become a link
const nm = E.renderCampaign({ v: 1, theme: E.DEFAULT_THEME, blocks: [{ id: "t", type: "text", text: "Hi {{name}}" }] }, { brandName: "B", subject: "S", vars: { name: "[click](https://evil.example)" } });
ok(!/href="https:\/\/evil/.test(nm.html), "brackets in a person's name don't make a link");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
