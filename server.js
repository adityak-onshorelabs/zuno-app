require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcrypt");
const { randomUUID } = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
let db;

async function connectDB() {
  await client.connect();
  db = client.db("zuno_mvp");
  console.log("Connected to MongoDB!");
}

// ─── Auth API ─────────────────────────────────────────────────────────────────

// POST /api/auth/signup
// Body: { "firstName": "Aditya", "lastName": "K", "email": "a@b.com", "password": "secret" }
app.post("/api/auth/signup", async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "firstName, lastName, email, and password are required." });
    }

    const existing = await db.collection("users").findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const user_id = randomUUID();

    await db.collection("users").insertOne({
      user_id,
      firstName,
      lastName,
      email: email.toLowerCase().trim(),
      password_hash,
      card_ids: [],
      created_at: new Date(),
      updated_at: new Date(),
    });

    res.status(201).json({ message: "Account created successfully.", user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
// Body: { "identifier": "a@b.com", "password": "secret" }
app.post("/api/auth/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: "identifier and password are required." });
    }

    const user = await db.collection("users").findOne({
      email: identifier.toLowerCase().trim(),
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    res.json({
      message: "Login successful.",
      user_id: user.user_id,
      firstName: user.firstName,
      email: user.email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Existing Endpoints ───────────────────────────────────────────────────────

// GET /api/cards — return all cards (id, bank, name only)
app.get("/api/cards", async (req, res) => {
  try {
    const cards = await db
      .collection("cards")
      .find({}, { projection: { card_id: 1, bank_name: 1, card_name: 1 } })
      .toArray();
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cards/search?q= — search by card or bank name
app.get("/api/cards/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const cards = await db
      .collection("cards")
      .find(
        {
          $or: [
            { card_name: { $regex: q, $options: "i" } },
            { bank_name: { $regex: q, $options: "i" } },
          ],
        },
        { projection: { card_id: 1, bank_name: 1, card_name: 1 } }
      )
      .toArray();
    res.json(cards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── User Wallet API ──────────────────────────────────────────────────────────

// POST /api/user/wallet — save or replace a user's card list
// Body: { "user_id": "aditya_01", "card_ids": [1073, 1074, 2001] }
app.post("/api/user/wallet", async (req, res) => {
  try {
    const { user_id, card_ids } = req.body;

    if (!user_id || !Array.isArray(card_ids)) {
      return res
        .status(400)
        .json({ error: "user_id (string) and card_ids (array) are required." });
    }

    // Validate that every supplied card_id actually exists
    const found = await db
      .collection("cards")
      .find({ card_id: { $in: card_ids } }, { projection: { card_id: 1 } })
      .toArray();

    const validIds = found.map((c) => c.card_id);
    const invalidIds = card_ids.filter((id) => !validIds.includes(id));
    if (invalidIds.length > 0) {
      return res
        .status(400)
        .json({ error: `Unknown card_id(s): ${invalidIds.join(", ")}` });
    }

    // Preserve existing tracked_spend for cards staying in wallet; init new cards at 0
    const existingUser = await db.collection("users").findOne({ user_id });
    const existingEntries = existingUser?.wallet_entries ?? {};
    const newEntries = {};
    for (const id of validIds) {
      const key = String(id);
      newEntries[key] = existingEntries[key] ?? {
        tracked_spend: 0,
        anniversary_date: new Date(),
      };
    }

    await db.collection("users").updateOne(
      { user_id },
      { $set: { user_id, card_ids: validIds, wallet_entries: newEntries, updated_at: new Date() } },
      { upsert: true }
    );

    res.json({ message: "Wallet saved.", user_id, card_ids: validIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user/wallet/:user_id — return the user's wallet with card details
app.get("/api/user/wallet/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await db
      .collection("users")
      .aggregate([
        { $match: { user_id } },
        {
          $lookup: {
            from: "cards",
            localField: "card_ids",
            foreignField: "card_id",
            as: "cards",
            pipeline: [
              {
                $project: {
                  _id: 0,
                  card_id: 1,
                  bank_name: 1,
                  card_name: 1,
                  annual_fee: 1,
                  key_benefits: 1,
                  trackers: 1,
                },
              },
            ],
          },
        },
        { $project: { _id: 0, user_id: 1, card_ids: 1, wallet_entries: 1, cards: 1, updated_at: 1 } },
      ])
      .toArray();

    if (result.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    const userData = result[0];
    const walletEntries = userData.wallet_entries ?? {};

    // Compute milestoneProgress for each card using user's tracked_spend
    const cardsWithProgress = userData.cards.map((card) => {
      const entry = walletEntries[String(card.card_id)];
      const milestoneTracker = Array.isArray(card.trackers)
        ? card.trackers.find((t) => t.type === "milestone")
        : null;

      let milestoneProgress = null;
      if (milestoneTracker) {
        milestoneProgress = {
          name: milestoneTracker.reward_label || "Spend Milestone",
          target: milestoneTracker.spend_goal,
          current: entry?.tracked_spend ?? 0,
          reward: milestoneTracker.reward_label,
          period: milestoneTracker.period ?? null,
          raw_text: milestoneTracker.raw_text ?? null,
        };
      }

      const { trackers: _trackers, ...cardFields } = card;
      return { ...cardFields, milestoneProgress };
    });

    res.json({ user_id: userData.user_id, card_ids: userData.card_ids, cards: cardsWithProgress, updated_at: userData.updated_at });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Spend Guide API ──────────────────────────────────────────────────────────

// POST /api/spend-guide — rank the user's cards for a given spend category
// Body: { "user_id": "aditya_01", "category": "dining" }
app.post("/api/spend-guide", async (req, res) => {
  try {
    const { user_id, category } = req.body;

    if (!user_id || !category) {
      return res
        .status(400)
        .json({ error: "user_id and category are required." });
    }

    const categoryKey = category.toLowerCase().trim();

    // 1. Fetch the user's wallet
    const user = await db.collection("users").findOne({ user_id });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    if (!user.card_ids || user.card_ids.length === 0) {
      return res.status(400).json({ error: "User wallet is empty." });
    }

    // 2. Fetch the full card documents for those IDs
    const cards = await db
      .collection("cards")
      .find({ card_id: { $in: user.card_ids } })
      .toArray();

    // 3. Score and annotate each card for the requested category
    const results = cards
      .map((card) => {
        const catData = card[categoryKey];

        // Category doesn't exist on this card at all
        if (!catData) {
          return {
            card_id: card.card_id,
            bank_name: card.bank_name,
            card_name: card.card_name,
            earn_rate: 0,
            earn_type: "not_applicable",
            conditions: [],
            cap: null,
            warning: `"${categoryKey}" is not a tracked category for this card.`,
          };
        }

        const baseEarn = catData.base_earn ?? 0;
        const accelEarn = catData.accelerated_earn ?? 0;
        const isExcluded = catData.exclusions === true;

        // Hard exclusion flag
        if (isExcluded || baseEarn === 0) {
          return {
            card_id: card.card_id,
            bank_name: card.bank_name,
            card_name: card.card_name,
            earn_rate: 0,
            earn_type: "excluded",
            conditions: catData.condition ?? [],
            cap: buildCap(catData),
            warning: isExcluded
              ? `${card.card_name} explicitly excludes "${categoryKey}".`
              : `${card.card_name} earns 0 points on "${categoryKey}".`,
          };
        }

        // Pick the best applicable earn rate
        const earnRate = accelEarn > baseEarn ? accelEarn : baseEarn;
        const earnType = accelEarn > baseEarn ? "accelerated" : "base";

        return {
          card_id: card.card_id,
          bank_name: card.bank_name,
          card_name: card.card_name,
          earn_rate: earnRate,
          earn_type: earnType,
          conditions: catData.condition ?? [],
          cap: buildCap(catData),
          brands: catData.brands ?? null,
          warning: null,
        };
      })
      // 4. Sort: highest earn rate first; zero-earners go to the bottom
      .sort((a, b) => b.earn_rate - a.earn_rate);

    res.json({
      category: categoryKey,
      ranked_cards: results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Creditpedia Detail API ───────────────────────────────────────────────────

// GET /api/cards/detail/:card_id — full card document for the Creditpedia screen
app.get("/api/cards/detail/:card_id", async (req, res) => {
  try {
    const card_id = parseInt(req.params.card_id, 10);
    if (isNaN(card_id)) {
      return res.status(400).json({ error: "card_id must be a number." });
    }

    const card = await db
      .collection("cards")
      .findOne({ card_id }, { projection: { _id: 0 } });

    if (!card) {
      return res.status(404).json({ error: `No card found with card_id ${card_id}.` });
    }

    res.json(card);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Wallet Management API ────────────────────────────────────────────────────

// DELETE /api/user/wallet/:user_id/:card_id — remove one card from the wallet
app.delete("/api/user/wallet/:user_id/:card_id", async (req, res) => {
  try {
    const { user_id } = req.params;
    const card_id = parseInt(req.params.card_id, 10);

    if (isNaN(card_id)) {
      return res.status(400).json({ error: "card_id must be a number." });
    }

    const result = await db.collection("users").updateOne(
      { user_id },
      {
        $pull: { card_ids: card_id },
        $unset: { [`wallet_entries.${card_id}`]: "" },
        $set: { updated_at: new Date() },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    if (result.modifiedCount === 0) {
      return res.status(400).json({ error: `card_id ${card_id} was not in the wallet.` });
    }

    res.json({ message: `Card ${card_id} removed from wallet.`, user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/user/wallet/:user_id/:card_id/spend — set tracked_spend for a card
// Body: { "tracked_spend": 150000 }
app.patch("/api/user/wallet/:user_id/:card_id/spend", async (req, res) => {
  try {
    const { user_id } = req.params;
    const card_id = parseInt(req.params.card_id, 10);
    const { tracked_spend } = req.body;

    if (isNaN(card_id)) {
      return res.status(400).json({ error: "card_id must be a number." });
    }
    if (typeof tracked_spend !== "number" || tracked_spend < 0) {
      return res.status(400).json({ error: "tracked_spend must be a non-negative number." });
    }

    const result = await db.collection("users").updateOne(
      { user_id },
      {
        $set: {
          [`wallet_entries.${card_id}.tracked_spend`]: tracked_spend,
          updated_at: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ message: "Spend updated.", user_id, card_id, tracked_spend });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Spending Warnings API ────────────────────────────────────────────────────

// POST /api/spend-warning — check if a specific card earns nothing on a category
// Body: { "user_id": "aditya_01", "card_id": 1073, "category": "rent" }
app.post("/api/spend-warning", async (req, res) => {
  try {
    const { user_id, card_id, category } = req.body;

    if (!user_id || !card_id || !category) {
      return res
        .status(400)
        .json({ error: "user_id, card_id, and category are required." });
    }

    const categoryKey = category.toLowerCase().trim();

    // Confirm the card is actually in the user's wallet
    const user = await db.collection("users").findOne({ user_id });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    if (!user.card_ids.includes(card_id)) {
      return res
        .status(400)
        .json({ error: `card_id ${card_id} is not in this user's wallet.` });
    }

    const card = await db.collection("cards").findOne({ card_id });
    if (!card) {
      return res.status(404).json({ error: `No card found with card_id ${card_id}.` });
    }

    const catData = card[categoryKey];

    // Category not tracked for this card at all
    if (!catData) {
      return res.json({
        user_id,
        card_id,
        card_name: card.card_name,
        category: categoryKey,
        warn: true,
        reason: `"${categoryKey}" is not a tracked spend category for ${card.card_name}.`,
      });
    }

    const baseEarn = catData.base_earn ?? 0;
    const accelEarn = catData.accelerated_earn ?? 0;

    // Check for an exclusion string inside the conditions array
    const exclusionKeywords = ["exclud", "not eligible", "not applicable", "not earn"];
    const conditionTexts = (catData.condition ?? []).map((c) => c.toLowerCase());
    const hasExclusionInConditions = conditionTexts.some((text) =>
      exclusionKeywords.some((kw) => text.includes(kw))
    );

    // exclusions field can be true (boolean) or a non-null string
    const hasExclusionFlag =
      catData.exclusions === true ||
      (typeof catData.exclusions === "string" && catData.exclusions.trim() !== "");

    const isZeroEarn = baseEarn === 0 && accelEarn === 0;
    const shouldWarn = isZeroEarn || hasExclusionFlag || hasExclusionInConditions;

    if (!shouldWarn) {
      return res.json({
        user_id,
        card_id,
        card_name: card.card_name,
        category: categoryKey,
        warn: false,
        earn_rate: accelEarn > baseEarn ? accelEarn : baseEarn,
        earn_type: accelEarn > baseEarn ? "accelerated" : "base",
      });
    }

    // Build a human-readable reason for the warning
    let reason;
    if (hasExclusionFlag) {
      reason =
        typeof catData.exclusions === "string"
          ? catData.exclusions
          : `${card.card_name} explicitly excludes "${categoryKey}" from earning rewards.`;
    } else if (hasExclusionInConditions) {
      const matchedCondition = (catData.condition ?? []).find((text) =>
        exclusionKeywords.some((kw) => text.toLowerCase().includes(kw))
      );
      reason = matchedCondition || `${card.card_name} has an exclusion on "${categoryKey}".`;
    } else {
      reason = `${card.card_name} earns 0 reward points on "${categoryKey}". Consider using a different card.`;
    }

    res.json({
      user_id,
      card_id,
      card_name: card.card_name,
      category: categoryKey,
      warn: true,
      reason,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function buildCap(catData) {
  if (!catData.cap_value) return null;
  return {
    value: catData.cap_value,
    unit: catData.cap_unit,
    period: catData.cap_period,
  };
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
connectDB()
  .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
  .catch((err) => {
    console.error("Failed to connect to DB:", err);
    process.exit(1);
  });
