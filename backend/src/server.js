import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.js";
import leadRoutes from "./routes/leads.js";
import campaignRoutes from "./routes/campaigns.js";
import competitorRoutes from "./routes/competitors.js";
import feedbackRoutes from "./routes/feedback.js";
import productRoutes from "./routes/products.js";
import publicRoutes from "./routes/public.js";

dotenv.config();

const app = express();
app.set("trust proxy", 1);

app.use(
  cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(
  express.json({
    limit: "10mb",
    // Keep the raw bytes around too — needed to verify the Resend webhook
    // signature, which is computed over the exact bytes as sent, not the
    // re-serialized JSON (whitespace/key-order differences would break it).
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// General rate limit.
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// AI endpoints are expensive — limit them harder.
const aiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: "Too many AI requests. Wait a minute and try again." },
});
app.use("/api/leads/search", aiLimiter);
app.use("/api/competitors/research", aiLimiter);

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/campaigns", campaignRoutes);
app.use("/api/competitors", competitorRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/products", productRoutes);
app.use("/api", publicRoutes); // unsubscribe + webhooks, no auth

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Something went wrong on our end." });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Ledger API listening on :${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) console.warn("⚠  ANTHROPIC_API_KEY not set — AI features will fail");
  if (!process.env.RESEND_API_KEY) console.warn("⚠  RESEND_API_KEY not set — sending will fail");
});
