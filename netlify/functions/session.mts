import type { Config } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/index.js";
import { adminSettings } from "../../db/schema.js";
import { getRole, getSettings, hashPassword, requireAdmin, sessionCookie, usesPreviewAdminCredentials, verifyAdminCredentials } from "../lib/auth.js";
import { ApiError, checkOrigin, handleError, json, readBody } from "../lib/http.js";

export default async (request: Request) => {
  try {
    checkOrigin(request);
    if (request.method === "GET") return json({ role: await getRole(request) });
    if (request.method === "DELETE") return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request) });
    if (request.method === "POST") {
      const body = await readBody(request);
      const role = body.role;
      if (role !== "admin") throw new ApiError(400, "Invalid login type.");
      const settings = await getSettings(true);
      if (!settings) throw new ApiError(503, "Staff login is not configured.");
      const password = typeof body.password === "string" ? body.password : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const valid = verifyAdminCredentials(email, password, settings);
      if (!valid) throw new ApiError(401, "Incorrect login details.");
      return json({ role, credentialSource: usesPreviewAdminCredentials() ? "environment" : "saved" }, 200, { "Set-Cookie": sessionCookie(request, role, settings) });
    }
    if (request.method === "PATCH") {
      await requireAdmin(request);
      const db = getDb();
      const body = await readBody(request);
      const updates: Partial<typeof adminSettings.$inferInsert> = {};
      if (body.admin_email !== undefined || body.admin_password !== undefined) {
        if (usesPreviewAdminCredentials()) {
          throw new ApiError(409, "Admin credentials for this preview are managed by Deploy Preview environment variables, not saved settings.");
        }
        if (typeof body.admin_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.admin_email.trim()) || body.admin_email.length > 254 || typeof body.admin_password !== "string" || !body.admin_password.trim() || body.admin_password.length > 256) {
          throw new ApiError(400, "Enter a valid email and password.");
        }
        updates.adminEmail = body.admin_email.trim();
        updates.passwordHash = hashPassword(body.admin_password);
      }
      if (!Object.keys(updates).length) throw new ApiError(400, "No settings supplied.");
      const [settings] = await db.update(adminSettings).set(updates).where(eq(adminSettings.id, "main")).returning();
      return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(request, "admin", settings) });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/session" };
