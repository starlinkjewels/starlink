// What the Settings search finds. Settings has sixteen sections, and the one a
// setting lives in is not always the one you would guess — the ₹ exchange rate
// is under Pricing, rhodium under Dropdown lists, a company's logo under
// Companies but the app's own under Brand Studio. So every section is listed
// with the words of the settings inside it (its field labels, read off the
// section itself), and a search matches those as well as the section's name.
//
// Some settings people look for here are kept on another page (who may see
// what, the Ready Stock offices, the automatic emails); those are "jump to"
// entries that take you there.
//
// When a setting is added to a section, add its label here too, or the search
// will not find it.
import { LIST_DEFS } from "@/lib/optionLists";

export interface SettingsEntry {
  /** The section's key, as Settings.tsx keeps it (and as ?tab= holds it). */
  key: string;
  /** The words of the settings in it — labels as they read on screen. */
  words: readonly string[];
}

export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  { key: "company", words: ["Company name", "Business name"] },
  { key: "invoice", words: [
    "Invoice / Bill settings", "Printed bill", "Address", "Street", "City / Area", "State & ZIP", "Tel no", "Primary phone",
    "Email", "Invoice terms", "COD", "Bill images", "Bank details", "USA wire", "International wire",
    "QR code", "Venmo / Pay", "Company stamp / seal",
  ] },
  { key: "pricing", words: [
    "Order value pricing rates", "Diamond rate ($ / ct)", "Metal rate ($ / g)", "Gold rate",
    "Exchange rates for profit (₹ per $1)", "Rupee rate", "Currency rates", "Foreign currency", "Live rates",
    "Who can read your cost figures", "Admin-only cost figures", "Default shipping charge",
    "Cashback % on delivered orders", "Gift card", "Max gift-card use per order", "Redeem",
  ] },
  { key: "labels", words: [
    "Barcode band on orders", "Show price on band", "Tag", "Label printers & bands", "Label size",
    "Jewellery tag", "Spec label", "Printer", "Print",
  ] },
  { key: "expenses", words: ["Expense categories", "Account categories", "Locker categories", "Salary category"] },
  // The dropdown lists themselves, so a list's own name (Rhodium, Stamping,
  // Clarities…) and where it shows both find this section.
  { key: "lists", words: ["Dropdown lists", "Options", "Karats", ...LIST_DEFS.flatMap(d => [d.title, d.hint])] },
  { key: "timeline", words: [
    "Production timeline", "Stages", "Steps", "Board columns", "A piece is delayed after", "Late",
    "Loose stones stages", "Make a piece",
  ] },
  { key: "orderpage", words: ["Order page", "Sections order", "Layout", "Drag to move", "Order header"] },
  { key: "videos", words: ["Videos", "Plays on every browser", "Web video", "iPhone video", "Make playable"] },
  { key: "companies", words: [
    "Companies", "Invoice prefix", "Company logo", "Stamp / seal", "Payment QR", "Bank details",
    "Address & contact", "Bank / wire details",
  ] },
  { key: "materials", words: ["Materials", "Gems", "Silver", "Platinum", "Grades", "Counted in", "Unit", "What it is"] },
  { key: "brand", words: [
    "Brand Studio", "Logo", "Logo on dark", "App icon", "Favicon", "Brand colour", "Colour code",
    "Theme", "Dark mode", "Corners", "Density", "Compact", "Company name", "Sign-in page",
  ] },
  { key: "appearance", words: [
    "Appearance", "New look", "Theme", "Light", "Dark", "Match device", "Accent colour",
    "Corners", "Text font", "Heading font", "Fonts",
  ] },
  { key: "tables", words: ["Table style", "Row spacing", "Striped rows", "Highlight row", "Column lines", "Compact", "Spacious"] },
  { key: "logins", words: ["Secure logins", "Provision logins", "Passwords"] },
  { key: "data", words: [
    "Backup", "Restore", "Export data", "Server totals", "Data size & speed", "Records in the database",
    "Duplicate accounts", "Merge", "Invoice numbers", "Renumber invoices", "Google Drive backup",
    "Stock showing less than it should", "Payments missing from the party's books", "Repair",
  ] },
];

/** A setting that lives on another page — the search takes you there. */
export interface SettingsJump {
  label: string;
  /** Where it is, in the app's own words. */
  where: string;
  to: string;
  words: readonly string[];
}

export const SETTINGS_JUMPS: readonly SettingsJump[] = [
  { label: "Staff access", where: "Employees → a person's ⋯ → Manage access", to: "/employees",
    words: ["Access", "Permissions", "Roles", "Access templates", "Who can see", "Make admin", "Give login", "Password reset", "Staff", "Employees"] },
  { label: "Ready Stock offices", where: "Ready Stock → ⋯ → Our offices", to: "/ready-stock",
    words: ["Offices", "Locations", "Branches", "Ready stock"] },
  { label: "Autopilot", where: "Automatic emails and reminders", to: "/autopilot",
    words: ["Autopilot", "Automatic emails", "Pipelines", "Email", "Reminders", "Automation"] },
];

export interface SettingsHit {
  key: string;
  /** Up to three of the setting words that matched, to say why it is listed. */
  matched: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/colour/g, "color");

/** Every word typed must appear in the section's name or one of its settings.
 *  "colour" and "color" are the same word here. */
function matches(q: string, title: string, words: readonly string[]): string[] | null {
  const parts = norm(q).split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const hay = [title, ...words].map(norm);
  if (!parts.every(p => hay.some(h => h.includes(p)))) return null;
  // Why it is listed: the settings that hold any of the words (not the name).
  return [...new Set(words.filter(w => parts.some(p => norm(w).includes(p))))].slice(0, 3);
}

/** The sections (of those shown to this person) a search finds — a name match first. */
export function searchSections(q: string, sections: readonly { id: string; label: string }[]): SettingsHit[] {
  const hits: (SettingsHit & { byName: boolean })[] = [];
  for (const s of sections) {
    const words = SETTINGS_INDEX.find(e => e.key === s.id)?.words ?? [];
    const m = matches(q, s.label, words);
    if (m) hits.push({ key: s.id, matched: m, byName: norm(q).split(/\s+/).every(p => !p || norm(s.label).includes(p)) });
  }
  return hits.sort((a, b) => Number(b.byName) - Number(a.byName)).map(({ key, matched }) => ({ key, matched }));
}

/** The settings on other pages a search finds. */
export function searchJumps(q: string): SettingsJump[] {
  return SETTINGS_JUMPS.filter(j => matches(q, j.label, j.words));
}
