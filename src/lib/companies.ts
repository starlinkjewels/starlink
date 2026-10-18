import type { Client, Company, DB, Invoice, Order, Settings, User } from "./db";

/**
 * Our companies — separate businesses, often in different countries, each
 * with its own name, logo, bank details and invoice numbers.
 *
 * The first company is not a record of its own: it IS the business's settings
 * (company name and the Invoice & Bill details), exactly as they were before
 * there was more than one. Everything that has no company on it — every
 * client, invoice and employee from before — belongs to it. Nothing old is
 * rewritten, and the first company's invoices keep their numbers and look.
 */
export const MAIN_COMPANY_ID = "main";

/** The first company, read from the settings it lives in. */
export function mainCompany(s: Settings): Company {
  return {
    id: MAIN_COMPANY_ID,
    name: s.companyName || "Shree Suktam Diamond",
    legalSuffix: s.companyLegalSuffix ?? "",
    country: s.companyCountry,
    currency: s.currency,
    invoicePrefix: "",
    logoUrl: s.companyLogoUrl,
    address1: s.invoiceAddress1, address2: s.invoiceAddress2, address3: s.invoiceAddress3,
    tel: s.invoiceTel, primary: s.invoicePrimary, email: s.invoiceEmail, website: s.invoiceWebsite,
    taxLabel: s.invoiceTaxLabel, taxId: s.invoiceTaxId,
    terms: s.invoiceTerms,
    qr1: s.invoiceQr1, qr2: s.invoiceQr2, stamp: s.invoiceStamp,
    bankImage1: s.bankDetailsImage1, bankImage2: s.bankDetailsImage2, bankText: s.invoiceBankText,
    active: true,
    createdAt: "",
  };
}

/** Every company, the first one first. Inactive ones included unless asked not to. */
export function companiesOf(s: Settings, activeOnly = false): Company[] {
  const all = [mainCompany(s), ...(s.companies ?? [])];
  return activeOnly ? all.filter(c => c.active !== false) : all;
}

/** More than one company — only then is "which company" asked anywhere. */
export function hasCompanies(s: Settings): boolean {
  return (s.companies ?? []).length > 0;
}

export function companyById(s: Settings, id: string | undefined): Company {
  if (!id || id === MAIN_COMPANY_ID) return mainCompany(s);
  return (s.companies ?? []).find(c => c.id === id) ?? mainCompany(s);
}

/** The company a client buys from. */
export function companyIdOfClient(c: Pick<Client, "companyId"> | undefined): string {
  return c?.companyId || MAIN_COMPANY_ID;
}

/** The company a record belongs to — anything without one is the first company's. */
export function companyOf(r: { companyId?: string } | undefined): string {
  return r?.companyId || MAIN_COMPANY_ID;
}

/** For writing: the field to put on a record, or nothing for the first company
 *  (older records have none, and they are the first company's). */
export function coField(companyId: string | undefined): { companyId?: string } {
  return companyId && companyId !== MAIN_COMPANY_ID ? { companyId } : {};
}

/** The company an order is for: fixed on it when placed; older orders, their client's. */
export function companyOfOrder(db: Pick<DB, "clients">, o: Pick<Order, "companyId" | "clientId" | "forReadyStock"> | undefined): string {
  if (!o) return MAIN_COMPANY_ID;
  if (o.companyId) return o.companyId;
  if (o.forReadyStock || !o.clientId) return MAIN_COMPANY_ID;
  return companyIdOfClient(db.clients.find(c => c.id === o.clientId));
}

/**
 * Whose stock and factory account an order's material work uses. A job that
 * already has material at the factory keeps that company — so an order begun
 * before stock was kept per company stays where its gold went — and a new job
 * uses the order's own company.
 */
export function workCompanyOf(db: Pick<DB, "clients" | "materialIssuances">, o: Pick<Order, "id" | "companyId" | "clientId" | "forReadyStock">): string {
  const first = (db.materialIssuances ?? []).find(i => i.orderId === o.id && i.source !== "melt");
  return first ? companyOf(first) : companyOfOrder(db, o);
}

/** The company that issued an invoice — fixed when it was raised. */
export function companyIdOfInvoice(i: Pick<Invoice, "companyId"> | undefined): string {
  return i?.companyId || MAIN_COMPANY_ID;
}

/**
 * The companies a person may put a new client under. An admin: all of them.
 * An employee: the ones they were given — or, if none were, all of them, as
 * every employee from before companies could.
 */
export function companiesForUser(s: Settings, u: Pick<User, "role" | "companyIds"> | null | undefined): Company[] {
  const all = companiesOf(s, true);
  if (!u || u.role === "admin" || !u.companyIds?.length) return all;
  return all.filter(c => u.companyIds!.includes(c.id));
}

/** Does this employee work for that company? (No list = every company.) */
export function worksFor(u: Pick<User, "role" | "companyIds">, companyId: string): boolean {
  return u.role === "admin" || !u.companyIds?.length || u.companyIds.includes(companyId);
}

/** Why a company's details can't be saved — or null when they can. */
export function companyProblem(c: Pick<Company, "id" | "name" | "invoicePrefix">, others: Company[]): string | null {
  if (!c.name.trim()) return "Give the company a name.";
  if (c.id === MAIN_COMPANY_ID) return null;
  const p = c.invoicePrefix.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(p)) return "The invoice prefix must be 2 to 6 letters or numbers, e.g. SJD.";
  if (others.some(o => o.id !== c.id && o.invoicePrefix.trim().toUpperCase() === p)) return `Another company already uses the prefix ${p}.`;
  if (others.some(o => o.id !== c.id && o.name.trim().toLowerCase() === c.name.trim().toLowerCase())) return "Another company already has that name.";
  return null;
}

/** The counter an invoice number for this company comes from. */
export function invoiceSequenceName(companyId: string): string {
  return companyId === MAIN_COMPANY_ID ? "invoiceNumber" : `invoiceNumber_${companyId}`;
}

/** What an invoice number of this company looks like: the first company's stay
 *  as they always were ("0042"); every other's carry its prefix ("SJD-0001"). */
export function formatInvoiceNumber(company: Company, seq: number): string {
  const n = String(seq).padStart(4, "0");
  return company.id === MAIN_COMPANY_ID ? n : `${company.invoicePrefix.trim().toUpperCase()}-${n}`;
}

/** The invoices that share this company's number series. */
export function invoicesOfCompany(invoices: Invoice[], companyId: string): Invoice[] {
  return invoices.filter(i => companyIdOfInvoice(i) === companyId);
}

/** Settings as a document for this company should print them: its own name,
 *  address, bank, QR codes and stamp in place of the first company's. */
export type BrandSettings = Settings & { brandCompanyId: string };
export function brandFor(s: Settings, companyId: string): BrandSettings {
  if (!companyId || companyId === MAIN_COMPANY_ID) return { ...s, brandCompanyId: MAIN_COMPANY_ID };
  const c = companyById(s, companyId);
  if (c.id === MAIN_COMPANY_ID) return { ...s, brandCompanyId: MAIN_COMPANY_ID };
  return {
    ...s,
    brandCompanyId: c.id,
    companyName: c.name,
    companyLegalSuffix: c.legalSuffix ?? "",
    companyLogoUrl: c.logoUrl,
    companyCountry: c.country,
    invoiceAddress1: c.address1, invoiceAddress2: c.address2, invoiceAddress3: c.address3,
    invoiceTel: c.tel, invoicePrimary: c.primary, invoiceEmail: c.email, invoiceWebsite: c.website,
    invoiceTaxLabel: c.taxLabel, invoiceTaxId: c.taxId,
    invoiceTerms: c.terms,
    invoiceQr1: c.qr1, invoiceQr2: c.qr2, invoiceStamp: c.stamp,
    bankDetailsImage1: c.bankImage1, bankDetailsImage2: c.bankImage2, invoiceBankText: c.bankText,
  };
}

/** The branding for a client's documents: an invoice's own company once it has
 *  one, otherwise the company the client buys from (a proforma, a statement). */
export function brandForDocument(db: Pick<DB, "settings" | "clients" | "invoices">, opts: { clientId?: string; invoiceNumber?: string; invoiceId?: string }): BrandSettings {
  const inv = (db.invoices ?? []).find(i => (opts.invoiceId && i.id === opts.invoiceId) || (opts.invoiceNumber && i.number === opts.invoiceNumber));
  if (inv) return brandFor(db.settings, companyIdOfInvoice(inv));
  const client = db.clients.find(c => c.id === opts.clientId);
  return brandFor(db.settings, companyIdOfClient(client));
}
