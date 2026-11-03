/**
 * The order rules are the Shopify integration's (functions-shopify/src/logic.ts):
 * what a line becomes on our order, which orders come in, the stages. Copied here
 * before each build so both read a store's mapping exactly alike.
 */
const fs = require("fs");
const path = require("path");
const from = path.join(__dirname, "..", "..", "functions-shopify", "src", "logic.ts");
const to = path.join(__dirname, "..", "src", "shared", "logic.ts");
const src = fs.readFileSync(from, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
fs.writeFileSync(to, "// GENERATED from functions-shopify/src/logic.ts by scripts/sync-logic.cjs - do not edit here." + nl + src);
console.log("shared: logic.ts");
