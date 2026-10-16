import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../utils/errors.js";
import { log } from "../utils/logger.js";

/** Wraps an async route so a thrown error reaches the error handler (Express 4 does not do this itself). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: "Not found" });
}

/** One place that turns errors into responses. Server errors are logged in full but never shown to the caller. */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request", field: error.issues[0]?.path.join(".") });
    return;
  }
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 500;
  if (status >= 500)
    log("error", "unhandled error", { requestId: req.requestId, path: req.path, message: error instanceof Error ? error.message : String(error) });
  res.status(status).json({ error: status >= 500 ? "Server error" : "Request failed" });
}
