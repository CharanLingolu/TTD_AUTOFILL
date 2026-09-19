import "dotenv/config";
import { connectDb, Coupon } from "../src/db.js";

const code = (process.argv[2] || "").trim().toUpperCase();
const maxUses = Number(process.argv[3] || 1);
const expiresAtArg = process.argv[4] || "";

if (!code) {
  console.error("Usage: npm run seed-coupon -- TTD-FREE-001 10 2026-12-31T23:59:59Z");
  process.exit(1);
}

await connectDb();
await Coupon.findOneAndUpdate(
  { code },
  {
    $set: {
      code,
      active: true,
      maxUses: Math.max(1, maxUses),
      expiresAt: expiresAtArg ? new Date(expiresAtArg) : null
    },
    $setOnInsert: { usedCount: 0 }
  },
  { upsert: true, new: true }
);
console.log(`Coupon ${code} is active. maxUses=${Math.max(1, maxUses)} expiresAt=${expiresAtArg || "never"}`);
process.exit(0);
