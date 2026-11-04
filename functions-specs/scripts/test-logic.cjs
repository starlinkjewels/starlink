/**
 * The reading rules on their own (no Firebase): design filing on names like the
 * catalogue's, and — when a folder of sample sheets is given — the OCR itself:
 *   node scripts/test-logic.cjs [samples-dir-with-meta.json]
 */
const fs = require("fs");
const path = require("path");
const { designOf, designKey, isDesignName, nameStem, roleOf, arrangeDesign, learnRules, isJunk } = require("../lib/shared/catalogMedia");
let fail = 0;
const eq = (a, b, what) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { fail++; console.log("FAIL", what, "→", JSON.stringify(a), "expected", JSON.stringify(b)); } };

const F = (id, name) => ({ id, name });
eq(designOf("SRG0034 B.jpg", [F("a", "SRG0034"), F("r", "Rings")]).key, "SRG34", "folder named as design");
eq(designOf("render 1.jpg", [F("o", "OLD"), F("a", "SLR-000944A"), F("r", "SLR")]).designNo, "SLR-000944A", "nearest design folder up the chain");
eq(designOf("SRG0053@.jpg", [F("n", "New folder"), F("r", "Ring")]).from, "file", "design from the file name in a plain folder");
eq(designKey("SRG400"), designKey("SRG0400"), "leading zeros are one design");
eq(isDesignName("WhatsApp Image 2025-09-19 at 11.56.26_5bedd4ea.jpg"), false, "phone names are not designs");
eq(isDesignName("Yaami-Spec-8573.pdf"), false, "SPEC is not a design");
eq(isDesignName("SLR-01"), false, "two digits are not a design");
eq(designOf("27.3dm", [F("m", "1.70 TO 4.00 MM")]).key, designOf("27.jpg", [F("m", "1.70 TO 4.00 MM")]).key, "namesakes in a folder group together");
eq(designOf("WhatsApp Image 2025-08-21 at 4.31.15 AM.jpeg", [F("d", "Daniel")]).designNo, "Daniel", "phone pictures: the folder is the piece");
eq(nameStem("33-ER-REF.jpg"), "33-ER", "view words come off");
eq(designOf("SRG0034.jpg", [F("a", "SRG0034")], { prefixes: ["SLR"] }).from, "group", "only the business's letters, when set");
eq(designOf("SRG0035.jpg", [F("a", "SRG0034")], { designFrom: "file" }).key, "SRG35", "file names only, when set");
for (const n of ["Rings 2025", "June 2025", "Order 1234", "Bands 2024", "SALE 2025", "RING 2023", "Studs_2024"]) eq(isDesignName(n), false, `${n} is not a design`);
for (const n of ["SRG0034", "SLR-000944A", "SBD0022 (6.50 MM)", "RG277@2"]) eq(isDesignName(n), true, `${n} is a design`);
eq(isDesignName("SRG 2025", { prefixes: ["SRG"] }), true, "SRG 2025 is a design where SRG is the business's own");
eq(isJunk("Thumbs.db") && isJunk("~$SER-001025.xlsx") && isJunk("a.3dmbak"), true, "junk");
eq([roleOf({ name: "a.3dm", type: "file" }), roleOf({ name: "a.xlsx", type: "file" }, true), roleOf({ name: "a.jpg", type: "image" }, true), roleOf({ name: "a.jpg", type: "image" })], ["cad", "sheet", "sheet", "render"], "roles");
const frames = Array.from({ length: 12 }, (_, i) => ({ id: "f" + i, name: `SRG0034_${String(i + 1).padStart(3, "0")}.jpg`, role: "render" }));
const ar = arrangeDesign([...frames, { id: "m", name: "SRG0034.jpg", role: "render" }, { id: "s", name: "SRG0034 sheet.jpg", role: "sheet" }]);
eq([ar.spin.length, ar.main, ar.sheets], [12, "m", ["s"]], "12 numbered angles are a 360° spin; the main picture is a render");
eq(arrangeDesign([{ id: "a", name: "1.jpg", role: "render" }, { id: "b", name: "2.jpg", role: "render" }, { id: "c", name: "5.jpg", role: "render" }]).spin.length, 0, "a few numbered pictures are not a spin");
eq(learnRules(["SRG0001", "SRG0002", "SRG0003", "IMAGE 2025", "IMG_2034", "SLR-000944A"]).prefixes, ["SRG"], "learns the business's letters");
console.log(fail ? `${fail} failed` : "filing rules: all passed");

(async () => {
  const dir = process.argv[2];
  if (!dir) { process.exit(fail ? 1 : 0); }
  const { readPicture, readExcel, stopEngine } = require("../lib/ocr");
  const { parseSpecs, better } = require("../lib/shared/specParse");
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const tally = { ok: 0, review: 0, noTable: 0 }; const times = [];
  for (const m of meta) {
    const t = await readPicture(fs.readFileSync(path.join(dir, m.f)));
    const ctx = { folderName: m.folder, fileName: m.name };
    const a = parseSpecs(t.page, ctx);
    const s = t.table ? (() => { const p = better(a, parseSpecs(t.table, ctx)); return { ...p, dimsMm: a.dimsMm.length ? a.dimsMm : p.dimsMm }; })() : a;
    tally[s.status]++; times.push(t.ms);
  }
  // An Excel sheet the same way.
  const ExcelJS = require("exceljs");
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("SPD0211");
  ws.addRow(["DESIGN", "SPD0211"]); ws.addRow(["14KT", 2.38, "GM"]); ws.addRow(["SHAPE", "SIEVE SIZE", "MM SIZE", "PTS", "QTY", "WEIGHT"]);
  ws.addRow(["RND", "+2-6.5", 1.3, 0.01, 24, 0.24]); ws.addRow(["PEAR", "", "5x3", 0.15, 2, 0.3]); ws.addRow(["Total", "", "", "", 26, 0.54]);
  const x = await readExcel(Buffer.from(await wb.xlsx.writeBuffer()));
  const xs = parseSpecs(x.page, { folderName: "SPD0211", fileName: "SPD0211.xlsx" });
  eq([xs.status, xs.stones.length, xs.stoneTotals, xs.metal], ["ok", 2, { pcs: 26, ct: 0.54 }, { "14K": 2.38 }], "Excel sheet");
  await stopEngine();
  times.sort((a, b) => a - b);
  console.log("pictures:", JSON.stringify(tally), `median ${times[Math.floor(times.length / 2)]} ms`, fail ? `· ${fail} failed` : "· all passed");
  process.exit(fail ? 1 : 0);
})();
