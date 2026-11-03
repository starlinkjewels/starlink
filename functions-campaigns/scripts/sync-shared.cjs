/**
 * Copies the two files this codebase shares, before every build (npm "prebuild"):
 * the campaign email's design and drawing (src/lib/pure/campaignEmail.ts — the
 * app's previews use the very same), and the AI provider's one chokepoint
 * (functions/src/lib/sarvam.ts — the only file that names it).
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "..");
const to = path.join(__dirname, "..", "src", "shared");
fs.mkdirSync(to, { recursive: true });
for (const [from, name] of [["src/lib/pure/campaignEmail.ts", "campaignEmail.ts"], ["functions/src/lib/sarvam.ts", "ai.ts"]]) {
  const src = fs.readFileSync(path.join(root, from), "utf8");
  const nl = src.includes("\r\n") ? "\r\n" : "\n";
  fs.writeFileSync(path.join(to, name), "// GENERATED from " + from + " by functions-campaigns/scripts/sync-shared.cjs - do not edit here." + nl + src);
  console.log("shared:", name);
}
