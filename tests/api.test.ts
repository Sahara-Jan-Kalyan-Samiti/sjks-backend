import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { makeDeps, paymentEvent, sign } from "./helpers.js";

describe("health and basics", () => {
  it("answers /health", async () => {
    const res = await request(createApp(makeDeps().deps)).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
  it("returns JSON 404 for unknown routes", async () => {
    const res = await request(createApp(makeDeps().deps)).get("/nope");
    expect(res.status).toBe(404);
  });
});

describe("Razorpay webhook", () => {
  const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = {}) =>
    request(app).post("/api/webhooks/razorpay").set("Content-Type", "application/json").set(headers).send(JSON.stringify(body));

  it("rejects a bad signature", async () => {
    const { deps, payments } = makeDeps();
    const res = await post(createApp(deps), paymentEvent("payment.captured", "captured"), { "x-razorpay-signature": "0".repeat(64) });
    expect(res.status).toBe(400);
    expect(payments.donations).toHaveLength(0);
  });

  it("rejects a missing signature", async () => {
    const res = await post(createApp(makeDeps().deps), paymentEvent("payment.captured", "captured"));
    expect(res.status).toBe(400);
  });

  it("records a valid captured payment once, even if delivered twice", async () => {
    const { deps, payments } = makeDeps();
    const app = createApp(deps);
    const body = paymentEvent("payment.captured", "captured");
    const headers = { "x-razorpay-signature": sign(JSON.stringify(body)), "x-razorpay-event-id": "evt_1" };
    expect((await post(app, body, headers)).body).toMatchObject({ ok: true, outcome: "created" });
    expect((await post(app, body, headers)).body).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(payments.donations).toHaveLength(1);
  });

  it("returns 503 when no webhook secret is configured", async () => {
    const base = makeDeps();
    const deps = { ...base.deps, env: { ...base.deps.env, RAZORPAY_WEBHOOK_SECRET: "" } };
    const res = await post(createApp(deps), paymentEvent("payment.captured", "captured"), { "x-razorpay-signature": "a" });
    expect(res.status).toBe(503);
  });
});

describe("staff-only routes", () => {
  it("need a token", async () => {
    const app = createApp(makeDeps().deps);
    expect((await request(app).get("/api/broadcast")).status).toBe(401);
    expect((await request(app).get("/api/donations/1/receipt")).status).toBe(401);
    expect((await request(app).get("/api/exports/donations.csv")).status).toBe(401);
  });
  it("reject a token that is not valid", async () => {
    const res = await request(createApp(makeDeps().deps)).get("/api/broadcast").set("Authorization", "Bearer nonsense");
    expect(res.status).toBe(401);
  });
  it("enforce roles: a viewer cannot broadcast or export, an editor cannot broadcast", async () => {
    const app = createApp(makeDeps().deps);
    expect((await request(app).get("/api/broadcast").set("Authorization", "Bearer viewer-token")).status).toBe(403);
    expect((await request(app).get("/api/broadcast").set("Authorization", "Bearer editor-token")).status).toBe(403);
    expect((await request(app).get("/api/exports/donations.csv").set("Authorization", "Bearer editor-token")).status).toBe(403);
    expect((await request(app).get("/api/broadcast").set("Authorization", "Bearer admin-token")).status).toBe(200);
  });
  it("only an administrator may create staff accounts, and the data is validated", async () => {
    const app = createApp(makeDeps().deps);
    const body = { email: "new@example.org", password: "longenough1" };
    expect((await request(app).post("/api/admins").send(body)).status).toBe(401);
    expect((await request(app).post("/api/admins").set("Authorization", "Bearer editor-token").send(body)).status).toBe(403);
    const weak = await request(app)
      .post("/api/admins")
      .set("Authorization", "Bearer admin-token")
      .send({ ...body, password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toMatch(/8 characters/);
  });
});

describe("public forms", () => {
  const volunteer = { name: "Ravi", phone: "98765 43210", email: "ravi@example.org", area: "Education" };

  it("accepts a valid volunteer and stores it as pending", async () => {
    const { deps, inserts } = makeDeps();
    const res = await request(createApp(deps)).post("/api/public/volunteers").send(volunteer);
    expect(res.status).toBe(200);
    expect(inserts).toEqual([{ table: "volunteers", row: expect.objectContaining({ name: "Ravi", status: "pending" }) }]);
  });

  it("rejects an invalid phone number", async () => {
    const res = await request(createApp(makeDeps().deps))
      .post("/api/public/volunteers")
      .send({ ...volunteer, phone: "12345" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });

  it("pretends success but stores nothing when the honeypot is filled", async () => {
    const { deps, inserts } = makeDeps();
    const res = await request(createApp(deps))
      .post("/api/public/volunteers")
      .send({ ...volunteer, website: "http://spam.example" });
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(0);
  });

  it("rate-limits repeated submissions from one address", async () => {
    const app = createApp(makeDeps().deps);
    let last = 200;
    for (let i = 0; i < 7; i++) last = (await request(app).post("/api/public/volunteers").send(volunteer)).status;
    expect(last).toBe(429);
  });
});

describe("CORS", () => {
  it("allows the website origin and not others", async () => {
    const app = createApp(makeDeps().deps);
    const ok = await request(app).get("/health").set("Origin", "https://www.saharangosag.com");
    const bad = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://www.saharangosag.com");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
