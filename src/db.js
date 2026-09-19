import mongoose from "mongoose";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");
  await mongoose.connect(uri);
  console.log("[DB] MongoDB connected");
}

const licenseSchema = new mongoose.Schema(
  {
    installationId: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ["pending", "active", "revoked"], default: "pending" },
    type: { type: String, enum: ["coupon"], default: "coupon" },
    couponCode: { type: String, default: null },
    activatedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: true },
    maxUses: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const License = mongoose.model("License", licenseSchema);
export const Coupon = mongoose.model("Coupon", couponSchema);
