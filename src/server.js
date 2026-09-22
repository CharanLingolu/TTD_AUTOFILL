import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { connectDb, Coupon, License } from "./db.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_DIR = path.join(__dirname, "../admin");

app.disable("x-powered-by");
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map((x) => x.trim()).filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    const localAdmin = origin === "http://localhost:8787" || origin === "http://127.0.0.1:8787";
    const localVite = origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
    const developmentExtension = process.env.NODE_ENV !== "production" && origin?.startsWith("chrome-extension://");
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin) || localAdmin || localVite || developmentExtension) callback(null, true);
    else callback(new Error("Origin not allowed"));
  }
}));

const apiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
app.use("/api/", apiLimiter);
app.use(express.json({ limit: "100kb" }));

// License/coupon state must never be served from an intermediary cache.
app.use("/api/", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "ttd-autofill-backend" }));
app.use("/admin", express.static(ADMIN_DIR, { index: "index.html", fallthrough: false }));
app.get("/admin", (_req, res) => res.sendFile(path.join(ADMIN_DIR, "index.html")));

function validInstallationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function publicLicense(license) {
  const now = Date.now();
  const expiresAt = license?.expiresAt ? new Date(license.expiresAt) : null;
  const remainingMs =
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? Math.max(0, expiresAt.getTime() - now)
      : null;

  if (!license) {
    return {
      status: "inactive",
      serverTime: now,
      expiresAt: null,
      remainingMs: null
    };
  }

  return {
    status: license.status,
    type: license.type,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt || null,
    remainingMs,
    serverTime: now,
    couponCode: license.couponCode || null
  };
}

async function syncLicenseFromCoupon(license) {
  if (!license) return null;

  if (!license.couponCode) return license;

  const coupon = await Coupon.findOne({
    code: String(license.couponCode).trim().toUpperCase()
  }).lean();

  // A coupon that was deleted or disabled immediately invalidates
  // every license that was issued from it.
  if (!coupon || coupon.active !== true) {
    if (license.status !== "revoked") {
      license.status = "revoked";
      await license.save();
    }
    return license;
  }

  // Coupon expiry is authoritative for the issued license.
  if (coupon.expiresAt && coupon.expiresAt <= new Date()) {
    if (license.status !== "revoked") {
      license.status = "revoked";
      await license.save();
    }
    return license;
  }

  let changed = false;
  if (!license.expiresAt || Number(license.expiresAt) !== Number(coupon.expiresAt)) {
    license.expiresAt = coupon.expiresAt || null;
    changed = true;
  }

  if (license.status === "revoked") {
    // Do not automatically reactivate a license that was manually revoked.
    return license;
  }

  if (changed) await license.save();
  return license;
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const provided = req.header("X-Admin-Token");
  if (!expected || !provided) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
}

function generateCouponCode() {
  return `TTDPRO-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

app.post("/api/coupon/redeem", async (req, res) => {
  try {
    const { installationId, code } = req.body || {};
    if (!validInstallationId(installationId) || typeof code !== "string") {
      return res.status(400).json({ ok: false, error: "Invalid request" });
    }

    const normalized = code.trim().toUpperCase();
    if (!normalized || normalized.length > 64) {
      return res.status(400).json({ ok: false, error: "Invalid coupon code" });
    }

    // If this installation already has an active license, return it.
    // This also keeps repeated taps on Apply idempotent.
    let existing = await License.findOne({ installationId });
    if (existing) {
      existing = await syncLicenseFromCoupon(existing);
      if (existing?.status === "active") {
        return res.json({
          ok: true,
          license: publicLicense(existing),
          message: "License already active."
        });
      }
    }

    // Do not use a MongoDB session/transaction here. Vercel serverless
    // deployments can be backed by MongoDB configurations where transactions
    // are unavailable, which previously caused HTTP 500 on coupon redemption.
    // The coupon usage increment itself is atomic via findOneAndUpdate.
    const coupon = await Coupon.findOneAndUpdate(
      {
        code: normalized,
        active: true,
        $expr: { $lt: ["$usedCount", "$maxUses"] },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]
      },
      { $inc: { usedCount: 1 } },
      { new: true }
    );

    if (!coupon) {
      return res.status(400).json({ ok: false, error: "Invalid or expired coupon" });
    }

    try {
      const activated = await License.findOneAndUpdate(
        { installationId },
        {
          $set: {
            status: "active",
            type: "coupon",
            couponCode: normalized,
            activatedAt: new Date(),
            expiresAt: coupon.expiresAt || null
          }
        },
        { upsert: true, new: true }
      );

      return res.json({
        ok: true,
        license: publicLicense(activated),
        message: "Coupon accepted. Pro is active."
      });
    } catch (licenseError) {
      // If license creation fails, put the coupon use back so a legitimate
      // customer does not lose a coupon because of a temporary DB error.
      try {
        await Coupon.updateOne(
          { _id: coupon._id, usedCount: { $gt: 0 } },
          { $inc: { usedCount: -1 } }
        );
      } catch (rollbackError) {
        console.error("[Coupon rollback]", rollbackError);
      }
      throw licenseError;
    }
  } catch (error) {
    console.error("[Coupon redeem]", error);
    return res.status(500).json({
      ok: false,
      error: "Could not redeem coupon",
      detail: process.env.NODE_ENV === "production" ? undefined : String(error?.message || error)
    });
  }
});

app.get("/api/license/check", async (req, res) => {
  try {
    const { installationId } = req.query;
    if (!validInstallationId(installationId)) return res.status(400).json({ ok: false, error: "Invalid installationId" });
    let license = await License.findOne({ installationId });
    if (license) {
      license = await syncLicenseFromCoupon(license);
    }
    return res.json({ ok: true, license: publicLicense(license) });
  } catch (error) {
    console.error("[License check]", error);
    return res.status(500).json({ ok: false, error: "Could not check license" });
  }
});

app.post("/api/admin/coupons", requireAdmin, async (req, res) => {
  try {
    const count = Math.min(Math.max(Number(req.body?.count || 1), 1), 100);
    const maxUses = Math.min(Math.max(Number(req.body?.maxUses || 1), 1), 100000);
    const expiryInput = typeof req.body?.expiresAt === "string" ? req.body.expiresAt.trim() : "";
    const expiresAt = expiryInput ? new Date(expiryInput) : null;
    if (expiryInput && Number.isNaN(expiresAt.getTime())) return res.status(400).json({ ok: false, error: "Invalid expiry date" });
    if (expiresAt && expiresAt <= new Date()) return res.status(400).json({ ok: false, error: "Expiry must be in the future" });

    const created = [];
    for (let i = 0; i < count; i++) {
      let saved = false;
      for (let attempt = 0; attempt < 8 && !saved; attempt++) {
        const code = generateCouponCode();
        try {
          const coupon = await Coupon.create({ code, active: true, maxUses, usedCount: 0, expiresAt });
          created.push({ code: coupon.code, maxUses: coupon.maxUses, expiresAt: coupon.expiresAt });
          saved = true;
        } catch (error) {
          if (error?.code !== 11000) throw error;
        }
      }
      if (!saved) throw new Error("Could not generate a unique coupon");
    }
    res.json({ ok: true, coupons: created });
  } catch (error) {
    console.error("[Admin coupon create]", error);
    res.status(500).json({ ok: false, error: "Could not create coupons" });
  }
});

app.get("/api/admin/coupons", requireAdmin, async (_req, res) => {
  try {
    const coupons = await Coupon.find({}, { code: 1, active: 1, maxUses: 1, usedCount: 1, expiresAt: 1, createdAt: 1 })
      .sort({ createdAt: -1 }).limit(200).lean();
    res.json({ ok: true, coupons });
  } catch (error) {
    console.error("[Admin coupon list]", error);
    res.status(500).json({ ok: false, error: "Could not load coupons" });
  }
});

app.patch("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: "Invalid coupon code" });

    const active = Boolean(req.body?.active);
    const coupon = await Coupon.findOneAndUpdate(
      { code },
      { $set: { active } },
      { new: true }
    );

    if (!coupon) return res.status(404).json({ ok: false, error: "Coupon not found" });

    if (!active) {
      // Immediately revoke every already-issued license using this coupon.
      await License.updateMany(
        { couponCode: code, status: "active" },
        { $set: { status: "revoked" } }
      );
    }

    res.json({
      ok: true,
      coupon: {
        code: coupon.code,
        active: coupon.active,
        maxUses: coupon.maxUses,
        usedCount: coupon.usedCount,
        expiresAt: coupon.expiresAt
      }
    });
  } catch (error) {
    console.error("[Admin coupon update]", error);
    res.status(500).json({ ok: false, error: "Could not update coupon" });
  }
});

app.delete("/api/admin/coupons/:code", requireAdmin, async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, error: "Invalid coupon code" });

    const deleted = await Coupon.findOneAndDelete({ code });
    if (!deleted) return res.status(404).json({ ok: false, error: "Coupon not found" });

    // Deleting a coupon immediately invalidates licenses issued from it.
    const revoked = await License.updateMany(
      { couponCode: code, status: "active" },
      { $set: { status: "revoked" } }
    );

    res.json({
      ok: true,
      deleted: {
        code: deleted.code,
        revokedLicenses: revoked.modifiedCount || 0
      }
    });
  } catch (error) {
    console.error("[Admin coupon delete]", error);
    res.status(500).json({ ok: false, error: "Could not delete coupon" });
  }
});

connectDb().then(() => {
  app.listen(PORT, () => console.log(`[Server] http://localhost:${PORT}`));
}).catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
