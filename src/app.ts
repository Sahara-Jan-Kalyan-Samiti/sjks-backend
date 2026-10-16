import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { requestContext } from "./middleware/requestContext.js";
import type { Authenticator } from "./middleware/requireAuth.js";
import { adminRoutes } from "./routes/admins.js";
import { broadcastRoutes } from "./routes/broadcast.js";
import { donationRoutes } from "./routes/donations.js";
import { healthRoutes } from "./routes/health.js";
import { publicRoutes } from "./routes/public.js";
import { requestRoutes } from "./routes/requests.js";
import { siteFormRoutes } from "./routes/siteForms.js";
import { webhookRoutes } from "./routes/webhooks.js";
import type { Mailer } from "./services/mailer.js";
import type { PaymentStore } from "./services/payments.js";

/** Everything the app talks to, passed in so tests can replace the real services. */
export interface AppDeps {
  env: Env;
  supabase: SupabaseClient;
  auth: Authenticator;
  payments: PaymentStore;
  mailer: Mailer;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  if (deps.env.TRUST_PROXY) app.set("trust proxy", 1); // Cloud Run sits behind Google's proxy
  app.use(requestContext);
  app.use(helmet());

  // The Razorpay webhook needs the exact raw bytes to check the signature, so it is mounted before the JSON parser.
  app.use("/api/webhooks", webhookRoutes(deps));

  // Only the website and the admin panel may call the API from a browser.
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || deps.env.CORS_ORIGINS.includes(origin)),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"]
    })
  );
  app.use(express.json({ limit: "100kb" }));

  app.use(healthRoutes());
  app.use("/api", apiLimiter);
  app.use("/api/public", publicRoutes(deps), siteFormRoutes(deps));
  app.use("/api/donations", donationRoutes(deps));
  app.use("/api/exports", donationRoutes(deps, { exportsOnly: true }));
  app.use("/api/requests", requestRoutes(deps));
  app.use("/api/broadcast", broadcastRoutes(deps));
  app.use("/api/admins", adminRoutes(deps));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
