import { z } from "zod";

/** All settings come from environment variables (Google Secret Manager / Cloud Run in production, `.env` locally). Invalid or missing values stop the server at start-up. */
const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  RAZORPAY_KEY_ID: z.string().default(""),
  RAZORPAY_KEY_SECRET: z.string().default(""),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(""),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  TRUST_PROXY: bool,
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASS: z.string().default(""),
  SMTP_FROM: z.string().default("")
});

/** In production a missing webhook secret or CORS list would silently disable payments or open the API wrongly, so it stops the start-up. */
const schema = base.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  if (!env.RAZORPAY_WEBHOOK_SECRET) ctx.addIssue({ code: "custom", path: ["RAZORPAY_WEBHOOK_SECRET"], message: "required in production" });
  if (!env.CORS_ORIGINS.length) ctx.addIssue({ code: "custom", path: ["CORS_ORIGINS"], message: "required in production" });
});

export type Env = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
