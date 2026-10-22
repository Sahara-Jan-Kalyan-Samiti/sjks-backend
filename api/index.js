// Vercel entry point: the same Express app as src/server.ts, exported as a serverless function instead of listening on a port.
// It runs from the compiled output (`npm run build` -> dist/), which vercel.json includes in the function.
import { createApp } from "../dist/app.js";
import { parseEnv } from "../dist/config/env.js";
import { createSupabaseAuthenticator } from "../dist/middleware/requireAuth.js";
import { createGateway } from "../dist/services/gateway.js";
import { createMailer } from "../dist/services/mailer.js";
import { createPaymentStore } from "../dist/services/paymentStore.js";
import { createSupabase } from "../dist/services/supabase.js";

const env = parseEnv();
const supabase = createSupabase(env);

export default createApp({
  env,
  supabase,
  auth: createSupabaseAuthenticator(supabase),
  payments: createPaymentStore(supabase),
  gateway: createGateway(env),
  mailer: createMailer(env)
});
