/**
 * Copies the app's pure account calculations (src/lib/pure) into
 * functions/src/shared, so the server keeps totals with exactly the code the
 * app shows them with. Runs before every build (npm "prebuild").
 *
 * The app's files import their record types from the app ("../db"), which the
 * server cannot load; the copies take them from ./types instead.
 */
const fs = require("fs");
const path = require("path");
const from = path.join(__dirname, "..", "..", "src", "lib", "pure");
const to = path.join(__dirname, "..", "src", "shared");
for (const f of fs.readdirSync(from).filter(n => n.endsWith(".ts"))) {
  const src = fs.readFileSync(path.join(from, f), "utf8").replace(/from "\.\.\/db"/g, 'from "./types"');
  const head = "// GENERATED from src/lib/pure/" + f + " by functions/scripts/sync-shared.cjs — do not edit here.\n";
  fs.writeFileSync(path.join(to, f), head + src);
  console.log("shared:", f);
}
