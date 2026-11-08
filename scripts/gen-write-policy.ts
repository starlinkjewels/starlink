/**
 * Writes the rulebook of who may write what (src/lib/pure/writePolicy.ts) into
 * firestore.rules, between its BEGIN/END GENERATED lines — so the database
 * rules and the app's own check before every save read the very same table.
 *
 *   npx tsx scripts/gen-write-policy.ts          (rewrite the block)
 *   npx tsx scripts/gen-write-policy.ts --check  (fail if it is out of date)
 *
 * Run it whenever writePolicy.ts changes, and commit both files together.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { READ_POLICY, WRITE_POLICY } from "../src/lib/pure/writePolicy";

const FILE = new URL("../firestore.rules", import.meta.url);
const BEGIN = "    // ── BEGIN GENERATED: write policy";
const END = "    // ── END GENERATED: write policy";

const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`;
const list = (xs: string[]) => `[${xs.map(q).join(", ")}]`;
// One small function per collection and operation: a rule reads only its own list
// (one map of everything, built on every check, ran past the rules' 1000-step limit).
const fn = (col: string, op: string) => `pol_${col}_${op}`;
const body = Object.entries(WRITE_POLICY)
  .flatMap(([col, p]) => (["create", "update", "delete"] as const).map(op => `    function ${fn(col, op)}() { return ${list(p[op])}; }`))
  .join("\n");
// Reading the money records: one list per locked collection, used as staffMay(rd_<collection>()).
const reads = Object.entries(READ_POLICY).map(([col, need]) => `    function rd_${col}() { return ${list(need)}; }`).join("\n");

const block = `${BEGIN} (scripts/gen-write-policy.ts, from src/lib/pure/writePolicy.ts) — do not edit by hand ──
    // Per collection and operation, the grants any one of which lets an employee
    // write — "*staff" any employee; an empty list, an admin only. Used as
    // staffMay(pol_<collection>_<operation>()).
${body}
    // Who may READ the money records (READ_POLICY) — anyone else's device never loads them.
${reads}
${END} ──`;

const src = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
const a = src.indexOf(BEGIN), b = src.indexOf(END);
if (a < 0 || b < 0) throw new Error("firestore.rules has no GENERATED write policy block");
const endOfEnd = src.indexOf("\n", b);
const next = src.slice(0, a) + block + src.slice(endOfEnd < 0 ? src.length : endOfEnd);
if (process.argv.includes("--check")) {
  if (next !== src) { console.error("firestore.rules: the write policy block is out of date — run npx tsx scripts/gen-write-policy.ts"); process.exit(1); }
  console.log("firestore.rules: write policy block up to date");
} else {
  writeFileSync(FILE, next);
  console.log(`firestore.rules: write policy block written (${Object.keys(WRITE_POLICY).length} collections)`);
}
