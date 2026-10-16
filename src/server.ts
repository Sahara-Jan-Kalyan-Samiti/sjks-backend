import { createApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createSupabaseAuthenticator } from "./middleware/requireAuth.js";
import { createMailer } from "./services/mailer.js";
import { createPaymentStore } from "./services/paymentStore.js";
import { createSupabase } from "./services/supabase.js";
import { log } from "./utils/logger.js";

function loadEnv() {
  try {
    return parseEnv();
  } catch (error) {
    // a clear list of what is wrong, not a stack trace
    log("error", "invalid configuration", { message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

const env = loadEnv();
const supabase = createSupabase(env);
const app = createApp({ env, supabase, auth: createSupabaseAuthenticator(supabase), payments: createPaymentStore(supabase), mailer: createMailer(env) });

const server = app.listen(env.PORT, () => log("info", "sjks-backend listening", { port: env.PORT, env: env.NODE_ENV }));

// Cloud Run sends SIGTERM before stopping an instance (Ctrl+C sends SIGINT locally): finish the requests in flight first.
function shutdown(signal: string) {
  log("info", "shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// A bug that escapes every handler is logged in full, then the instance restarts instead of running in an unknown state.
process.on("unhandledRejection", (reason) => {
  log("error", "unhandled rejection", { message: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (error) => {
  log("error", "uncaught exception", { message: error.message });
  process.exit(1);
});
