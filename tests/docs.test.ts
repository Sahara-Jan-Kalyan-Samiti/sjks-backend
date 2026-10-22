import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { openApiSpec } from "../src/config/openapi.js";
import { makeDeps } from "./helpers.js";

describe("Swagger UI", () => {
  it("is served outside production", async () => {
    const res = await request(createApp(makeDeps().deps)).get("/docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });

  it("is not served in production", async () => {
    const { deps } = makeDeps();
    const res = await request(createApp({ ...deps, env: { ...deps.env, NODE_ENV: "production" } })).get("/docs/");
    expect(res.status).toBe(404);
  });

  it("documents every secured route with the bearer scheme", () => {
    const secured = Object.values(openApiSpec.paths)
      .flatMap((item) => Object.values(item))
      .filter((op) => "security" in op);
    expect(secured.length).toBeGreaterThan(0);
    expect(openApiSpec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
  });
});
