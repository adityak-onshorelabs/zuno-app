# Redemption Catalog Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `seed-redemptions.js` — a standalone, idempotent script that reads `master_redemption.json` and embeds each card's `redemption_catalog` array into the matching document in the `zuno_mvp.cards` MongoDB collection.

**Architecture:** Two pure, exported functions (`deduplicateCatalog`, `injectRedemptions`) do the heavy lifting and are tested in isolation. A `main()` function wires them together with a real DB connection and is only called when the file is executed directly. Tests use Node 22's built-in `node:test` runner — no extra dependencies.

**Tech Stack:** Node.js 22 (CommonJS), `mongodb` ^7, `dotenv`, `node:test`, `node:assert/strict`

---

### Task 1: Scaffold `seed-redemptions.js` with exported functions

**Files:**
- Create: `seed-redemptions.js`

- [ ] **Step 1: Create the file with the two exported functions and a stub `main()`**

```js
require("dotenv").config();
const { MongoClient } = require("mongodb");
const path = require("path");

/**
 * Deduplicate raw JSON entries by card_id.
 * First occurrence wins. Genuine collisions (same card_id, different card_name)
 * are skipped and recorded. Exact duplicates are silently dropped.
 *
 * @param {Array} entries  Raw array from master_redemption.json
 * @returns {{ map: Map<number, object>, collisions: Array }}
 */
function deduplicateCatalog(entries) {
  const map = new Map();
  const collisions = [];

  for (const entry of entries) {
    if (map.has(entry.card_id)) {
      const existing = map.get(entry.card_id);
      if (existing.card_name !== entry.card_name) {
        collisions.push({
          card_id: entry.card_id,
          kept: existing.card_name,
          skipped: entry.card_name,
        });
      }
      continue;
    }
    map.set(entry.card_id, entry);
  }

  return { map, collisions };
}

/**
 * For each entry in catalogMap, set redemption_catalog on the matching cards doc.
 * Cards not found in the DB are recorded in `skipped`.
 *
 * @param {object} db       MongoDB Db instance
 * @param {Map}    catalogMap  Map<card_id, entry> from deduplicateCatalog
 * @returns {{ injected: number, skipped: Array }}
 */
async function injectRedemptions(db, catalogMap) {
  const skipped = [];
  let injected = 0;

  for (const [card_id, entry] of catalogMap) {
    const result = await db.collection("cards").updateOne(
      { card_id },
      { $set: { redemption_catalog: entry.redemption_catalog } },
      { upsert: false }
    );

    if (result.matchedCount === 0) {
      skipped.push({
        card_id,
        bank_name: entry.bank_name,
        card_name: entry.card_name,
      });
    } else {
      injected++;
    }
  }

  return { injected, skipped };
}

async function main() {
  // wired up in Task 3
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { deduplicateCatalog, injectRedemptions };
```

- [ ] **Step 2: Verify the file loads without errors**

```bash
node -e "require('./seed-redemptions')"
```

Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add seed-redemptions.js
git commit -m "feat: scaffold seed-redemptions with exported dedup and inject functions"
```

---

### Task 2: Test and validate `deduplicateCatalog`

**Files:**
- Create: `seed-redemptions.test.js`

- [ ] **Step 1: Write the failing tests**

```js
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deduplicateCatalog } = require("./seed-redemptions");

test("normal entry is added to map", () => {
  const entries = [
    { card_id: 1, bank_name: "AMEX", card_name: "Gold", redemption_catalog: [{ partner_name: "Emirates" }] },
  ];
  const { map, collisions } = deduplicateCatalog(entries);
  assert.equal(map.size, 1);
  assert.equal(collisions.length, 0);
  assert.deepEqual(map.get(1).card_name, "Gold");
});

test("exact duplicate is silently dropped, map has one entry", () => {
  const entry = { card_id: 2, bank_name: "HDFC", card_name: "Regalia", redemption_catalog: [] };
  const { map, collisions } = deduplicateCatalog([entry, { ...entry }]);
  assert.equal(map.size, 1);
  assert.equal(collisions.length, 0);
});

test("genuine collision keeps first, records collision", () => {
  const first  = { card_id: 1042, bank_name: "BoB", card_name: "Empower",      redemption_catalog: [] };
  const second = { card_id: 1042, bank_name: "BoB", card_name: "IRCTC RuPay",  redemption_catalog: [] };
  const { map, collisions } = deduplicateCatalog([first, second]);
  assert.equal(map.size, 1);
  assert.equal(map.get(1042).card_name, "Empower");
  assert.equal(collisions.length, 1);
  assert.equal(collisions[0].kept, "Empower");
  assert.equal(collisions[0].skipped, "IRCTC RuPay");
});

test("multiple distinct cards all appear in map", () => {
  const entries = [
    { card_id: 10, bank_name: "A", card_name: "X", redemption_catalog: [] },
    { card_id: 11, bank_name: "B", card_name: "Y", redemption_catalog: [] },
    { card_id: 12, bank_name: "C", card_name: "Z", redemption_catalog: [] },
  ];
  const { map } = deduplicateCatalog(entries);
  assert.equal(map.size, 3);
});
```

- [ ] **Step 2: Run the tests — expect all to pass**

```bash
node --test seed-redemptions.test.js
```

Expected output (all green):
```
▶ normal entry is added to map
✓ normal entry is added to map
▶ exact duplicate is silently dropped, map has one entry
✓ exact duplicate is silently dropped, map has one entry
▶ genuine collision keeps first, records collision
✓ genuine collision keeps first, records collision
▶ multiple distinct cards all appear in map
✓ multiple distinct cards all appear in map
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

- [ ] **Step 3: Add test script to `package.json`**

In `package.json`, replace the `"test"` script:
```json
"scripts": {
  "test": "node --test seed-redemptions.test.js"
}
```

- [ ] **Step 4: Confirm `npm test` works**

```bash
npm test
```

Expected: same 4 passing tests as above.

- [ ] **Step 5: Commit**

```bash
git add seed-redemptions.test.js package.json
git commit -m "test: add deduplicateCatalog unit tests"
```

---

### Task 3: Test and validate `injectRedemptions`

**Files:**
- Modify: `seed-redemptions.test.js`

- [ ] **Step 1: Add mock-db tests for `injectRedemptions` to the test file**

Append to `seed-redemptions.test.js`:

```js
const { injectRedemptions } = require("./seed-redemptions");

function makeMockDb(matchedCount) {
  return {
    collection: () => ({
      updateOne: async (_filter, _update, _opts) => ({ matchedCount }),
    }),
  };
}

test("injectRedemptions counts injected when card is found", async () => {
  const db = makeMockDb(1);
  const catalogMap = new Map([
    [1403, { card_id: 1403, bank_name: "AMEX", card_name: "Gold", redemption_catalog: [] }],
  ]);
  const { injected, skipped } = await injectRedemptions(db, catalogMap);
  assert.equal(injected, 1);
  assert.equal(skipped.length, 0);
});

test("injectRedemptions records skipped when card not found in DB", async () => {
  const db = makeMockDb(0);
  const catalogMap = new Map([
    [1180, { card_id: 1180, bank_name: "IDFC FIRST BANK", card_name: "Millennia", redemption_catalog: [] }],
  ]);
  const { injected, skipped } = await injectRedemptions(db, catalogMap);
  assert.equal(injected, 0);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].card_id, 1180);
  assert.equal(skipped[0].card_name, "Millennia");
});

test("injectRedemptions handles mixed found/not-found correctly", async () => {
  let callCount = 0;
  const db = {
    collection: () => ({
      updateOne: async () => ({ matchedCount: callCount++ === 0 ? 1 : 0 }),
    }),
  };
  const catalogMap = new Map([
    [1403, { card_id: 1403, bank_name: "AMEX", card_name: "Gold",     redemption_catalog: [] }],
    [1180, { card_id: 1180, bank_name: "IDFC", card_name: "Millennia", redemption_catalog: [] }],
  ]);
  const { injected, skipped } = await injectRedemptions(db, catalogMap);
  assert.equal(injected, 1);
  assert.equal(skipped.length, 1);
});
```

- [ ] **Step 2: Run all tests — expect 7 passing**

```bash
npm test
```

Expected:
```
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

- [ ] **Step 3: Commit**

```bash
git add seed-redemptions.test.js
git commit -m "test: add injectRedemptions unit tests with mock db"
```

---

### Task 4: Wire up `main()` and run the seed

**Files:**
- Modify: `seed-redemptions.js`

- [ ] **Step 1: Replace the stub `main()` with the real implementation**

In `seed-redemptions.js`, replace the `async function main() { // wired up in Task 3 }` block with:

```js
async function main() {
  const raw = require(path.join(__dirname, "master_redemption.json"));

  // 1. Deduplicate
  const { map: catalogMap, collisions } = deduplicateCatalog(raw);

  if (collisions.length > 0) {
    console.log("\n⚠️  COLLISIONS (kept first entry, skipped second):");
    collisions.forEach(({ card_id, kept, skipped }) =>
      console.log(`   card_id ${card_id}: kept "${kept}", skipped "${skipped}"`)
    );
  }

  console.log(`\nUnique cards to process: ${catalogMap.size}`);

  // 2. Connect to DB
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  console.log("Connected to MongoDB.");
  const db = client.db("zuno_mvp");

  try {
    // 3. Inject
    const { injected, skipped } = await injectRedemptions(db, catalogMap);

    // 4. Report skips
    if (skipped.length > 0) {
      console.log("\n⚠️  SKIPPED (card_id not found in DB):");
      skipped.forEach(({ card_id, bank_name, card_name }) =>
        console.log(`   ${card_id} — ${bank_name} / ${card_name}`)
      );
    }

    // 5. Summary
    console.log("\n─────────────────────────────────");
    console.log(`✅ Injected : ${injected}`);
    console.log(`⚠️  Skipped  : ${skipped.length}`);
    console.log(`⚠️  Collisions: ${collisions.length}`);
    console.log("─────────────────────────────────\n");
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 2: Confirm all 7 tests still pass (main() change must not affect exports)**

```bash
npm test
```

Expected:
```
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

- [ ] **Step 3: Run the seed against the real database**

```bash
node seed-redemptions.js
```

Expected output (exact counts may vary slightly if DB state differs):
```
⚠️  COLLISIONS (kept first entry, skipped second):
   card_id 1042: kept "Empower", skipped "BoB IRCTC RuPay"
   ... (other exact-dupe collisions are silently dropped)

Unique cards to process: 343
Connected to MongoDB.

⚠️  SKIPPED (card_id not found in DB):
   1144 — ICICI BANK / Platinum Business Card
   1151 — ICICI BANK / Business Ascent Card
   1180 — IDFC FIRST BANK / Millennia
   1181 — IDFC FIRST BANK / Select
   1182 — IDFC FIRST BANK / Classic
   1183 — IDFC FIRST BANK / HPCL First Power Plus
   1185 — IDFC FIRST BANK / Club Vistara
   1186 — IDFC FIRST BANK / Private
   1187 — IDFC FIRST BANK / Wealth
   1444 — IDFC FIRST BANK / Ashva
   1445 — IDFC FIRST BANK / LIC Classic
   1446 — IDFC FIRST BANK / LIC Select
   1447 — IDFC FIRST BANK / Maurya
   1448 — IDFC FIRST BANK / SWYP

─────────────────────────────────
✅ Injected : 329
⚠️  Skipped  : 14
⚠️  Collisions: 1
─────────────────────────────────
```

- [ ] **Step 4: Verify injection via spot-check**

```bash
node -e "
require('dotenv').config();
const { MongoClient } = require('mongodb');
const client = new MongoClient(process.env.MONGO_URI);
client.connect().then(async () => {
  const card = await client.db('zuno_mvp').collection('cards').findOne(
    { card_id: 1403 },
    { projection: { card_id: 1, card_name: 1, redemption_catalog: 1 } }
  );
  console.log(JSON.stringify(card, null, 2));
  await client.close();
});
"
```

Expected: document with `card_id: 1403`, `card_name: "Gold Charge"`, and a populated `redemption_catalog` array with 15+ entries.

- [ ] **Step 5: Commit**

```bash
git add seed-redemptions.js
git commit -m "feat: wire main() in seed-redemptions and inject redemption_catalog into cards"
```

---

### Task 5: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `redemption_catalog` field to the `cards` Collection section**

In the `### \`cards\` Collection` section of `CLAUDE.md`, add after the existing seeding description:

```markdown
**Redemption Catalog:** A third data source, `master_redemption.json` (project root), is injected via `seed-redemptions.js`. It adds a `redemption_catalog` array to each card:
```json
{ "partner_name": "Emirates Skywards", "partner_type": "Airlines", "conversion_ratio": "3:2", "point_value_inr": null }
```
Run with `node seed-redemptions.js` after `seed.js`. Idempotent.
```

- [ ] **Step 2: Move this task to "Current Project State" in `CLAUDE.md`**

Add the following entry under `### Milestone 6` (or create a new `### Milestone 7` block):

```markdown
### Milestone 7 — Redemption Catalog Seed Complete

| File | Purpose |
|---|---|
| `seed-redemptions.js` | Standalone idempotent script — embeds `redemption_catalog[]` into `cards` docs from `master_redemption.json` |
| `seed-redemptions.test.js` | Unit tests for dedup and inject logic using `node:test` |
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for redemption catalog seed milestone"
```
