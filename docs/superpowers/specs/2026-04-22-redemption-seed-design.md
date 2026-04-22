# Redemption Catalog Seed — Design Spec

**Date:** 2026-04-22  
**Status:** Approved  
**Scope:** Inject `master_redemption.json` into the `zuno_mvp` MongoDB database by embedding a `redemption_catalog` array into existing `cards` documents.

---

## Context

`master_redemption.json` contains 355 entries across 343 unique card IDs, with 1,111 total redemption partner entries. This data powers the planned "Wealth Optimizer" features. The backend uses the MongoDB native driver (no ORM), and the established seeding pattern is standalone Node.js scripts (see `seed.js`).

---

## Data Model

No new collection. The `redemption_catalog` array is embedded directly into existing `cards` documents:

```js
{
  card_id: 1403,
  bank_name: "AMEX",
  card_name: "Gold Charge",
  // ... all existing reward + creditpedia fields ...
  redemption_catalog: [
    { partner_name: "British Airways Club", partner_type: "Airlines", conversion_ratio: "3:2", point_value_inr: null },
    { partner_name: "Marriott Bonvoy", partner_type: "Hotels", conversion_ratio: "1:1", point_value_inr: null }
  ]
}
```

**No new indexes.** The field is always fetched as part of the parent card document; it is never queried independently.

---

## Script: `seed-redemptions.js`

A new standalone Node.js script at the project root, following the same pattern as `seed.js`.

### Algorithm

1. **Load & deduplicate** `master_redemption.json` into a `Map<card_id, entry>`:
   - First occurrence wins.
   - If a subsequent entry for the same `card_id` has a **different `card_name`** (genuine collision), log `⚠️ COLLISION` and skip the second entry.
   - Exact duplicates (same `card_id` + same `card_name`) are silently dropped.
   - Known collision: `card_id 1042` — `"BoB Empower"` vs `"BoB IRCTC RuPay"`. First entry (`BoB Empower`) is kept.

2. **Connect to MongoDB** via `MONGO_URI` from `.env`.

3. **For each unique card**, run:
   ```js
   db.collection("cards").updateOne(
     { card_id },
     { $set: { redemption_catalog } },
     { upsert: false }
   )
   ```
   - `matchedCount === 0` → log `⚠️ SKIPPED (not in DB): card_id X — BankName / CardName`

4. **Print summary**: counts of injected ✅, skipped ⚠️, collisions ⚠️.

5. Close the DB connection.

### Idempotency

Running the script twice produces the same result. The second run overwrites `redemption_catalog` with identical data.

### Known skips (14 cards at time of writing)

Cards present in `master_redemption.json` but absent from the seeded `cards` collection — these banks have no source files in `data/` yet:

- ICICI BANK: `1144` (Platinum Business), `1151` (Business Ascent)
- IDFC FIRST BANK: `1180`–`1188`, `1444`–`1448`

These will surface in the script's warning output and can be resolved by adding the corresponding `idfc-conditionalreward.json` / `idfc-creditpedia.json` pair to `data/` and re-running `seed.js`, then `seed-redemptions.js`.

---

## API Surface

No new endpoints are introduced by this task. The existing endpoint returns the full card document, which will include `redemption_catalog` automatically after the seed runs:

```
GET /api/cards/detail/:card_id  →  full card doc (redemption_catalog included)
```

A future convenience endpoint (`GET /api/redemptions/:card_id`) may be added when Wealth Optimizer UI screens are built, but is out of scope here.

---

## Out of Scope

- Auth/session changes
- New frontend screens
- Partner-level indexes or cross-card redemption queries
- Creating stub card documents for missing card IDs
