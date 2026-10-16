import rateLimit from "express-rate-limit";

/**
 * Per-IP limit for the public form endpoints (5 per 15 minutes by default).
 * The counter is kept in memory per instance. If Cloud Run runs several instances, move it to a shared store (Redis / Memorystore).
 */
export const formLimiter = (max = 5, windowMs = 15 * 60_000) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: "Too many requests. Please try again in a few minutes." });
    }
  });

/** A gentler limit for everything else under /api. */
export const apiLimiter = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false });
