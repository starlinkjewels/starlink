# New Modules Proposal — Manufacturing & Accounts

**For:** [Client Name] — Diamond Jewellery Manufacturing & Sales
**Prepared by:** Starlink Jewels Software Team
**Status:** Draft — for client review and approval before development begins

---

## 1. Why these new modules

The system already handles Orders, Clients, Invoices, and Payments very well — this covers the *selling* side of the business.

Because this business also **manufactures** its own jewellery (buying raw gold and diamonds, making pieces in-house through karigars/factories), four more connected sections are needed so that money, gold, and diamonds are tracked accurately from the moment they're purchased to the moment a finished piece is sold to a client:

1. **Locker** — bank accounts & cash
2. **Supplier & Purchases** — buying gold and diamonds (in INR or $)
3. **Stock (Bag)** — how much gold and diamond is currently in hand
4. **Factory** — jewellery actually being made, and its cost

Plus two things that tie it all together: a **buy-new-or-use-stock choice right on the Order** itself, and a **Dashboard** giving you an at-a-glance view of production, stock, and pending payments across all of the above.

These sections connect to each other and to the Orders you already use, so everything ties together in one place — no need to track anything separately in a notebook or Excel.

---

## 2. Locker — Bank Accounts & Cash

**In simple words:** every bank account and your cash box gets its own "Locker" inside the software. Every rupee coming in or going out is recorded against one specific Locker, so the software's balance always matches your real bank balance and cash in hand — exactly, to the rupee.

**What you can do:**
- Add as many Lockers as you have accounts — e.g. "HDFC Bank," "SBI Current A/C," "Cash in Hand" — each with a starting balance.
- Every time money comes in from a client (already tracked as Income/Passbook today) or goes out as an Expense, you pick **which Locker** it happened in.
- Move money between Lockers — e.g. depositing cash into the bank — recorded as a Transfer, so both balances update correctly.
- See each Locker's running balance at any time: opening balance + all income − all expenses (and transfers) through it.
- See a full history for one Locker — every transaction, in order, like a bank statement.

**Why this matters:** at month-end, your books match your actual bank statement without any manual reconciliation.

---

## 3. Supplier & Purchases — Buying Gold and Diamonds

**In simple words:** a place to record every supplier you buy gold or diamonds from, and every purchase — whether it's bought specifically for one client's order, or just to keep in stock for later.

**Suppliers:**
- Add supplier details — name, contact number, address, GST number.
- See a running account for each supplier, same as you already see for clients: total purchased, total paid, and balance you still owe them.

**Recording a purchase:**
- Choose the supplier.
- Choose the material: **Gold** or **Diamond**.
  - For **Gold**: weight (grams), purity (22K, 18K, etc.), rate per gram, total cost.
  - For **Diamond**: carat weight, quality details (shape, clarity, color if known), rate per carat, total cost, certificate number if certified.
- Choose the purpose:
  - **"For a specific Order"** — pick the order; this purchase's cost gets attached directly to that order.
  - **"For General Stock"** — no specific order yet; this adds straight into your Stock (see below), ready to use for any future order.
- Record how much you paid the supplier right away, and how much is still owed — and which Locker the payment came out of.

**Buying in Dollars ($):** since diamonds (and sometimes gold) are often billed in USD, every purchase lets you choose the currency it was billed in:
- If **INR** — enter the cost directly, as usual.
- If **USD** — enter the dollar amount, then enter **that day's exchange rate** yourself (a manual rate, not looked up automatically). The software immediately calculates the INR equivalent and uses that for everything else — the supplier's balance owed, the ledger, and every pending/paid figure always shows in INR, so you never have to convert anything by hand.

**Payment status:** every purchase clearly shows **Paid** vs **Pending** — and the Supplier account (below) rolls this up into one total-pending-across-all-purchases figure for that supplier, so you always know at a glance who you still owe money to and how much.

**Why this matters:** you always know exactly what you've bought, from whom, whether it's already assigned to a client's order or sitting in stock, and how much you still owe each supplier — in INR, even when the purchase itself was billed in dollars.

---

## 4. Stock (Bag) — Gold & Diamond Inventory

**In simple words:** a running total of how much gold and how many diamonds you physically have on hand right now, not yet used in any piece of jewellery.

**How stock changes:**
- **Goes up** when a "For General Stock" purchase is recorded (Section 3).
- **Goes down** when gold or diamonds are issued to a Factory to make jewellery (Section 5), or used directly for an order.

**What you'll see:**
- Current gold stock, grouped by purity — e.g. 22K: 340g, 18K: 120g.
- Current diamond stock — either as a running carat total, or as individual named parcels/lots if you'd prefer to track specific batches separately (**please confirm which you'd like — see Section 9**).
- A simple in/out history for stock, same style as your existing Income Passbook — date, in or out, quantity, running balance.

**Why this matters:** you'll always know exactly how much raw material you're holding, without needing to physically count it to check.

---

## 5. Factory — Manufacturing & Making Charges

**In simple words:** a place to track jewellery actually being made — which factory/karigar is making it, how much gold you gave them, what came back as finished pieces, and what it cost you in making charges.

**Factories:**
- Add each factory/karigar — name, contact, location.

**When an order needs to be manufactured:**
- Pick which Factory is making it, right from the Order.
- Record the gold issued to that factory for this order — e.g. "100g of 22K gold issued to Factory A on 24-Jul for Order SLJ-2026-1020."
- As pieces are completed (they may come back one at a time), record each finished piece: what it is, and how much gold it actually used.
- The software tracks the difference between gold issued and gold used in finished pieces automatically — so wastage, making-loss, or gold returned is never lost track of.
- Record the **making charges** — what you pay the factory for their labour (per gram or per piece, whichever you use) — and this cost is added into the order's total automatically. Making charges show **Paid** vs **Pending**, same as supplier purchases.

**Factory account:** for each factory, see total gold issued to them, total gold accounted for (used + returned), total making charges billed, and how much of that is still pending — same running-account style as Suppliers and Clients.

**Showing up on the Order itself:** every one of these steps — factory assigned, gold issued, each finished piece recorded, making charge added — is automatically added to that **Order's existing Timeline**, right alongside its normal status history (Waiting → In Production → Dispatched, etc.). Opening any order shows its full manufacturing story in one place, not spread across separate screens.

**Why this matters:** you'll know exactly where your gold is at any moment — with a factory being worked on, or back in stock — the true cost of manufacturing gets added to every order automatically, and anyone opening the order can see exactly what happened and when.

---

## 6. Creating an Order — Buy New or Use Stock

**In simple words:** when a new order needs gold or diamonds, the person creating it picks, right there on the Order screen, whether to use material already sitting in Stock or buy new material specifically for this order.

- **"Use from Stock"** — shows what's currently available (e.g. current 22K gold stock, current diamond stock) so you can see straight away if there's enough before committing it to this order. Confirming it deducts that amount from Stock and attaches it to the Order.
- **"Buy New for this Order"** — takes you straight into recording a Purchase (Section 3) already linked to this Order, so the cost flows into the order's total automatically and nothing needs to be entered twice.

**Why this matters:** the person creating the order never has to separately check Stock or remember to record a linked purchase — it's one decision, made at the moment it's needed, and the numbers on both sides (Stock, Supplier, Order cost) stay correct automatically.

---

## 7. Manufacturing & Supply Dashboard — at a glance

**In simple words:** one summary screen that pulls together the most important numbers from the four sections above, so you can see the health of your manufacturing and supply chain without opening each section separately.

At a glance, you'll see:
- **Orders currently in production** — how many, and which factory each is at.
- **Gold reserve** — current total stock on hand (Section 4).
- **Making charges pending** — how much you currently owe across all factories, not yet paid (Section 5).
- **Supplier payments — paid vs. pending** — how much you've paid your gold/diamond suppliers, and how much is still outstanding (Section 3).

Every figure here is calculated live from the actual purchases, issues, and payments recorded elsewhere in the system — never a separately-typed total that could drift out of sync with the real numbers.

---

## 8. How it all connects — one example, start to finish

1. You buy **200g of 22K gold** (billed in INR) and **a small parcel of diamonds** billed in **$3,000 USD** from a supplier → recorded as two **Purchases**, "For General Stock." For the diamond purchase, you enter that day's exchange rate (say ₹84/$) — the software calculates and stores ₹2,52,000 automatically. Your **Stock** goes up by 200g gold + the diamonds.
2. A client places an **Order** for a diamond ring.
3. On the Order, you choose **"Use from Stock"** for both the gold and diamonds needed, and pick **Factory A** to make it → issuing **20g of gold** + the diamonds from Stock to that factory → Stock goes down, Factory A's account shows 20g gold issued, and an entry appears on the **Order's Timeline**.
4. Factory A finishes the ring — you record it: **18.5g of gold used** in the finished ring (1.5g accounted as making-loss), plus their **making charge** for the labour, marked **Pending** until paid. Another Timeline entry appears on the Order.
5. The making charge is added automatically to the **Order's total cost**, alongside the gold and diamond cost already recorded.
6. The client pays for the order → recorded as **Income**, into a chosen **Locker** (bank account) → that Locker's balance updates, and your books match your real bank balance.
7. Meanwhile, the **Dashboard** (Section 7) shows at a glance: this order still in production at Factory A (until marked complete), current gold reserve after this issue, the making charge still pending to Factory A, and the ₹2,52,000 still owed (or paid) to the diamond supplier.

Every rupee, every gram of gold, and every dollar converted to rupees is accounted for, from purchase to finished piece to payment received — without touching a separate notebook or spreadsheet.

---

## 9. A few things we need you to confirm before we start building

These are small decisions that change how the screens work — please just tell us your preference for each, in plain terms, and we'll build it exactly that way:

1. **Diamond stock** — would you like diamonds tracked as one running carat total (simple), or as individual named parcels/lots (e.g. "Parcel #4 — 12 stones, 3.2 carats total") that you can pick from individually when issuing to a factory?
2. **Making charges** — are these usually a fixed rate per gram of gold, a fixed rate per finished piece, or negotiated separately each time?
3. **Multiple factories per order** — can one order ever be split across more than one factory (e.g. the ring made at Factory A, a separate pendant at Factory B), or is it always exactly one factory per order?
4. **Suppliers** — does a single supplier ever sell you both gold and diamonds, or are your gold suppliers and diamond suppliers always separate?
5. **Who can use these new sections** — should Locker, Supplier, Stock, and Factory be visible only to Admin, or should Employees be able to use them too (with the same "only my assigned clients" restriction they already have for orders)? Clients themselves would **not** see any of this — it's purely internal to the business.
6. **Exchange rate** — should the rate you enter on a purchase apply only to that one purchase, or would you also like an easy way to set "today's rate" once and have it suggested (still editable) on every purchase you record that day?

---

## 10. On accuracy — how we make sure the numbers are always right

Since this replaces manual tracking with real money and real stock, accuracy is the most important requirement — more important than any single feature. Three things guarantee this:

- **Nothing is manually totaled.** Every balance, every pending amount, every stock figure shown anywhere in the app (Dashboard, Supplier account, Factory account, Stock) is calculated live from the actual purchases, issues, payments, and completed pieces you've recorded — never a separately-typed number that could go out of sync with reality.
- **Stock and money can't go below zero silently.** If an attempted stock issue or payment would create an inconsistent state (e.g. issuing more gold than you have in Stock), the software stops and tells you, rather than quietly recording a wrong number.
- **Every change is tested against your real, live data before going live** — since this system already runs your business today, each new section is verified carefully so nothing already working (Orders, Clients, Invoices) is ever disturbed.

---

## 11. What happens after you approve this

Once you confirm the points in Section 9 (or tell us to just go with the simplest option for anything you're not sure about), development begins. Since the system is already live with real business data, we'll build and test each section carefully before it goes live, so your existing Orders, Clients, and Invoices are never disturbed.
