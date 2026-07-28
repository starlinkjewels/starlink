# Known limitations (tracked, deliberately deferred)

These are known and understood. They are **not** bugs in normal single-operator use — they only surface under genuine concurrent writes, and fixing them safely means moving those collections onto the same atomic-transaction pattern as `src/lib/stock.ts`. That is a larger, riskier refactor than the fixes shipped so far, so it is intentionally deferred rather than rushed into a live production app.

## 1. Certified diamond packet issuance is not transactional (M5)

`diamondPackets` is part of the array-sync engine in `src/lib/db.ts` (last-write-wins diffing), not the transactional module in `src/lib/stock.ts`.

- **Effect:** if two staff issue the *same* certified packet to two different orders at the exact same moment, both writes can succeed and the packet ends up referenced by two orders.
- **Why it's low risk today:** certified packets are discrete, individually named items that a person physically hands to one factory. In practice one packet is issued once, by one person. The pooled gold / loose-diamond stock — where a real race is plausible — *is* already protected by a floor-checked Firestore transaction in `stock.ts`.
- **Proper fix (deferred):** move packet status changes (`in_stock` → `issued` → `used`) into a `runTransaction` read-check-write in `stock.ts`, so a packet already `issued` can't be issued again.

## 2. Ready Stock quantity is not transactional

Same class of issue for `ReadyStockItem.quantity`.

- **Effect:** two clients buying the last identical piece at the same instant could both succeed, driving quantity below the real stock.
- **Why it's low risk today:** most ready-stock pieces are one-off, and order approval is a human step (an admin approves each order) that catches an oversell before anything ships.
- **Proper fix (deferred):** decrement `quantity` inside a floor-checked transaction at order-approval time, mirroring `decreaseStock`.

---

If either of these starts happening in practice, the fix is the same shape as `decreaseStock` in `src/lib/stock.ts` — that module is the reference implementation for "inventory that must never go negative under concurrency."
