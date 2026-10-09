import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getContext } from "@netlify/functions";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { adminSettings } from "../../db/schema.js";
import { ApiError } from "./http.js";

const cookieName = "pgb_session";
const sessionSeconds = 12 * 60 * 60;
export type Role = "admin" | "viewer";

export function hashPassword(value: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(value, salt, 64).toString("hex")}`;
}

export function verifyPassword(value: string, stored: string | null) {
  if (!stored || value.length > 256) return false;
  const [salt, hash] = stored.split(":");
  const actual = scryptSync(value, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function usesPreviewAdminCredentials() {
  return getContext().deploy.context === "deploy-preview";
}

function previewAdminCredentials() {
  if (!usesPreviewAdminCredentials()) return null;
  const email = Netlify.env.get("ADMIN_EMAIL")?.trim();
  const password = Netlify.env.get("ADMIN_PASSWORD");
  if (!email || !password || email.length > 254 || password.length > 256) {
    throw new ApiError(503, "Staff login needs valid Deploy Preview configuration. Please contact the site administrator.");
  }
  return { email, password };
}

export function verifyAdminCredentials(email: string, password: string, settings: typeof adminSettings.$inferSelect) {
  const configured = previewAdminCredentials();
  if (!configured) return verifyPassword(password, settings.passwordHash) && email === settings.adminEmail;
  if (password.length > 256) return false;
  const supplied = createHash("sha256").update(password).digest();
  const expected = createHash("sha256").update(configured.password).digest();
  return timingSafeEqual(supplied, expected) && email === configured.email;
}

export async function getSettings(initialize = false) {
  const [settings] = await db.select().from(adminSettings).where(eq(adminSettings.id, "main")).limit(1);
  if (settings || !initialize) return settings;
  const adminEmail = Netlify.env.get("ADMIN_EMAIL")?.trim();
  const password = Netlify.env.get("ADMIN_PASSWORD");
  const viewerPin = Netlify.env.get("VIEWER_PIN");
  if (!adminEmail || !password) {
    throw new ApiError(503, "Staff login needs server configuration. Please contact the site administrator.");
  }
  await db.insert(adminSettings).values({
    id: "main", adminEmail, passwordHash: hashPassword(password),
    viewerPinHash: viewerPin ? hashPassword(viewerPin) : null,
  }).onConflictDoNothing();
  return getSettings();
}

function signature(role: Role, expires: string, settings: typeof adminSettings.$inferSelect) {
  const configured = role === "admin" ? previewAdminCredentials() : null;
  if (configured) {
    const key = scryptSync(configured.password, `pgb-preview-admin-session:${configured.email}`, 64);
    return createHmac("sha256", key).update(`environment.${role}.${expires}.${configured.email}`).digest("hex");
  }
  const key = role === "admin" ? settings.passwordHash : settings.viewerPinHash;
  if (!key) return "";
  return createHmac("sha256", key).update(`${role}.${expires}.${settings.adminEmail}`).digest("hex");
}

export function sessionCookie(request: Request, role?: Role, settings?: typeof adminSettings.$inferSelect) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  if (!role || !settings) return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
  const expires = String(Math.floor(Date.now() / 1000) + sessionSeconds);
  const value = `${role}.${expires}.${signature(role, expires, settings)}`;
  return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionSeconds}${secure}`;
}

export async function getRole(request: Request): Promise<Role | null> {
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const parts = cookie.slice(cookieName.length + 1).split(".");
  const [role, expires, provided] = parts;
  if (parts.length !== 3 || (role !== "admin" && role !== "viewer") || !/^\d+$/.test(expires) || Number(expires) <= Date.now() / 1000 || !/^[a-f0-9]{64}$/.test(provided)) return null;
  const settings = await getSettings();
  if (!settings) return null;
  const expected = signature(role, expires, settings);
  if (!expected) return null;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex")) ? role : null;
}

export async function requireAdmin(request: Request) {
  if (await getRole(request) !== "admin") throw new ApiError(403, "Admin login is required.");
}
