/**
 * Copies the rate rules (src/lib/pure/liveRates.ts — the app's screens use the
 * very same) into this codebase before every build (npm "prebuild").
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const to = path.join(__dirname, "..", "src", "shared");
fs.mkdirSync(to, { recursive: true });
for (const [from, name] of [["src/lib/pure/liveRates.ts", "liveRates.ts"]]) {
  const src = fs.readFileSync(path.join(root, from), "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(path.join(to, name), "// GENERATED from " + from + " by functions-rates/scripts/sync-shared.cjs - do not edit here." + nl + src);
  console.log("shared:", name);
}
