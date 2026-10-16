import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createSupabaseAuthenticator } from "./middleware/requireAuth.js";
import { createMailer } from "./services/mailer.js";
import { createPaymentStore } from "./services/paymentStore.js";
import { createSupabase } from "./services/supabase.js";
import { log } from "./utils/logger.js";

const env = parseEnv();
const supabase = createSupabase(env);
const app = createApp({ env, supabase, auth: createSupabaseAuthenticator(supabase), payments: createPaymentStore(supabase), mailer: createMailer(env) });

const server = app.listen(env.PORT, () => log("info", "sjks-backend listening", { port: env.PORT, env: env.NODE_ENV }));

// Cloud Run sends SIGTERM before stopping an instance: finish the requests in flight first.
process.on("SIGTERM", () => {
  log("info", "shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
});
