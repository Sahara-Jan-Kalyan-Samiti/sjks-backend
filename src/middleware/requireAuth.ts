import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../utils/errors.js";

export type AdminRole = "admin" | "editor" | "viewer";
export interface AdminUser {
  id: string;
  email: string;
  label: string;
  role: AdminRole;
}

/** Turns an access token into a staff member, or null. Production uses Supabase; tests use a fake. */
export interface Authenticator {
  verify(token: string): Promise<AdminUser | null>;
}

declare module "express-serve-static-core" {
  interface Request {
    admin?: AdminUser;
    requestId?: string;
  }
}

/** Verifies the Supabase access token, then requires an *active* row in admin_profiles. No row means no access. */
export function createSupabaseAuthenticator(supabase: SupabaseClient): Authenticator {
  return {
    async verify(token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;
      const { data: profile } = await supabase.from("admin_profiles").select("display_name, role, is_active").eq("id", data.user.id).maybeSingle();
      if (!profile || !profile.is_active) return null;
      return { id: data.user.id, email: data.user.email ?? "", label: profile.display_name || data.user.email || "Admin", role: profile.role as AdminRole };
    }
  };
}

/** Requires `Authorization: Bearer <Supabase access token>` from a signed-in, active staff member. */
export const requireAuth = (auth: Authenticator) => async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new HttpError(401, "Please sign in.");
    const admin = await auth.verify(token);
    if (!admin) throw new HttpError(401, "Your session is not valid. Please sign in again.");
    req.admin = admin;
    next();
  } catch (error) {
    next(error);
  }
};

/** Allows only the listed roles (use after requireAuth). */
export const requireRole =
  (...roles: AdminRole[]) =>
  (req: Request, _res: Response, next: NextFunction) =>
    req.admin && roles.includes(req.admin.role) ? next() : next(new HttpError(403, "You do not have permission to do this."));
