const { MongoClient } = require("mongodb");
const fs = require("fs");
const path = require("path");

// Replace with your actual MongoDB Atlas connection string
const uri =
	"mongodb+srv://adityak-onshore:8ieepNYLwl4L7wdD@zuno.o1sm8as.mongodb.net/?appName=Zuno";
const client = new MongoClient(uri);

async function seedAllData() {
	try {
		await client.connect();
		console.log("Connected to MongoDB!");

		const db = client.db("zuno_mvp");
		const cardsCollection = db.collection("cards");

		// 1. Clear existing data to avoid duplicates while testing
		await cardsCollection.deleteMany({});
		console.log("Cleared existing collection.");

		// 2. Read the data directory
		const dataDir = path.join(__dirname, "data");
		const files = fs.readdirSync(dataDir);

		// 3. Find all unique banks based on file prefixes (e.g., 'amex' from 'amex-conditionalreward.json')
		const banks = [...new Set(files.map((f) => f.split("-")[0]))];

		let allMergedCards = [];

		// 4. Loop through each bank and process its files
		for (const bank of banks) {
			// ---> UPDATED NAMING CONVENTION HERE <---
			const crFile = path.join(dataDir, `${bank}-conditionalreward.json`);
			const pediaFile = path.join(dataDir, `${bank}-creditpedia.json`);

			// Check if both files exist for the bank
			if (fs.existsSync(crFile) && fs.existsSync(pediaFile)) {
				const crRaw = JSON.parse(fs.readFileSync(crFile, "utf-8"));

				// Handle different JSON structures (e.g., if AMEX is wrapped in {"AMEX": [...]})
				let crData;
				if (Array.isArray(crRaw)) {
					crData = crRaw;
				} else {
					const topLevelKey = Object.keys(crRaw)[0];
					crData = crRaw[topLevelKey];
				}

				const pediaData = JSON.parse(fs.readFileSync(pediaFile, "utf-8"));

				// Merge the two arrays based on card_id
				const mergedForBank = crData.map((crCard) => {
					const matchingPedia =
						pediaData.find((p) => p.card_id === crCard.card_id) || {};
					return {
						...matchingPedia,
						...crCard,
					};
				});

				allMergedCards.push(...mergedForBank);
				console.log(
					`Processed ${mergedForBank.length} cards for ${bank.toUpperCase()}`,
				);
			} else {
				// If it finds a file like ".DS_Store" or an unmatched bank file, it will skip gracefully
				if (bank !== "." && bank !== "") {
					console.warn(
						`⚠️ Warning: Missing a matching pair for bank prefix: ${bank}`,
					);
				}
			}
		}

		// 5. Insert all compiled cards into MongoDB in one bulk transaction
		if (allMergedCards.length > 0) {
			const result = await cardsCollection.insertMany(allMergedCards);
			console.log(
				`\n✅ Success! ${result.insertedCount} total cards seeded into the database!`,
			);

			// 6. Create Indexes for fast searching
			await cardsCollection.createIndex({ card_id: 1 }, { unique: true });
			await cardsCollection.createIndex({ bank_name: 1 });
			await cardsCollection.createIndex({ card_name: 1 });
			console.log("Database indexes created successfully.");
		} else {
			console.log("\nNo valid data found to insert.");
		}
	} catch (error) {
		console.error("Error seeding data:", error);
	} finally {
		await client.close();
	}
}

seedAllData();
