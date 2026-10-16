import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { log } from "../utils/logger.js";

/** Gives every request an id (returned as X-Request-Id) and logs one line when it finishes. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  req.requestId = req.header("x-request-id") || randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  const started = Date.now();
  res.on("finish", () => {
    if (req.path === "/health") return;
    log("info", "request", { requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started });
  });
  next();
}
