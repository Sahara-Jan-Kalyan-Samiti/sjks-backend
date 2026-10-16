type Level = "info" | "warn" | "error";

/** One JSON line per event: Cloud Logging reads `severity` and `message` directly. Never log donor PAN, phone or e-mail. */
export function log(level: Level, message: string, fields: Record<string, unknown> = {}): void {
  if (process.env.NODE_ENV === "test") return;
  const line = JSON.stringify({ severity: level.toUpperCase(), message, time: new Date().toISOString(), ...fields });
  (level === "error" ? console.error : console.log)(line);
}
