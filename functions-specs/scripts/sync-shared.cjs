/**
 * Copies the shared rules into this codebase before every build (npm "prebuild"):
 * the spec-table reader (src/lib/pure/specParse.ts), the design filing rules
 * (src/lib/pure/catalogMedia.ts), and a design's price (src/lib/pure/pricing.ts,
 * with the per-gram rates of src/lib/pure/liveRates.ts) — the app's screens use the very same files.
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const to = path.join(__dirname, "..", "src", "shared");
fs.mkdirSync(to, { recursive: true });
for (const [from, name] of [["src/lib/pure/specParse.ts", "specParse.ts"], ["src/lib/pure/catalogMedia.ts", "catalogMedia.ts"], ["src/lib/pure/pricing.ts", "pricing.ts"], ["src/lib/pure/liveRates.ts", "liveRates.ts"]]) {
  const src = fs.readFileSync(path.join(root, from), "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(path.join(to, name), "// GENERATED from " + from + " by functions-specs/scripts/sync-shared.cjs - do not edit here." + nl + src);
  console.log("shared:", name);
}
