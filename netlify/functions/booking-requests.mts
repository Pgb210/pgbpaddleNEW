import type { Config } from "@netlify/functions";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookingRequests, bookings } from "../../db/schema.js";
import { requireAdmin } from "../lib/auth.js";
import { checkAvailability, lockDate, serializeBooking, validateBooking } from "../lib/booking.js";
import { sendConfirmationEmail, sendRequestNotification } from "../lib/email.js";
import { ApiError, checkOrigin, handleError, json, readBody } from "../lib/http.js";

export default async (request: Request) => {
  try {
    checkOrigin(request);
    if (request.method === "GET") {
      await requireAdmin(request);
      const rows = await db.select().from(bookingRequests).where(eq(bookingRequests.status, "PENDING")).orderBy(asc(bookingRequests.createdAt));
      return json(rows);
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      const details = validateBooking(body, true);
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      if (phone.length > 40 || (phone && !/^[+\d\s().-]{5,40}$/.test(phone))) throw new ApiError(400, "Enter a valid phone number, or leave it blank.");
      if (body.website) throw new ApiError(400, "Unable to submit this request.");
      const created = await db.transaction(async transaction => {
        await lockDate(transaction, details.bookingDate);
        await checkAvailability(transaction, details);
        const [created] = await transaction.insert(bookingRequests).values({ ...details, phone: phone || null, status: "PENDING" }).returning();
        return created;
      });
      let notificationSent = false;
      try {
        notificationSent = await sendRequestNotification(created);
        if (notificationSent) await db.update(bookingRequests).set({ notificationSent: true }).where(eq(bookingRequests.id, created.id));
      } catch {
        console.warn("Request saved, but admin email notification was unavailable.");
      }
      return json({ id: created.id, status: "PENDING", message: "Request received. Your booking is not confirmed until an admin approves it." }, 201);
    }
    if (request.method === "PATCH") {
      await requireAdmin(request);
      const body = await readBody(request);
      if (typeof body.id !== "string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(body.id) || (body.action !== "approve" && body.action !== "reject" && body.action !== "notify")) {
        throw new ApiError(400, "Choose a valid request and action.");
      }
      const [existing] = await db.select().from(bookingRequests).where(eq(bookingRequests.id, body.id)).limit(1);
      if (!existing) throw new ApiError(404, "Request not found.");
      if (body.action === "notify") {
        if (existing.status !== "PENDING") throw new ApiError(409, "This request has already been reviewed.");
        const notificationSent = await sendRequestNotification(existing);
        if (notificationSent) await db.update(bookingRequests).set({ notificationSent: true }).where(eq(bookingRequests.id, existing.id));
        return json({ notification_sent: notificationSent });
      }
      const result = await db.transaction(async transaction => {
        await lockDate(transaction, existing.bookingDate);
        const [pending] = await transaction.select().from(bookingRequests).where(eq(bookingRequests.id, existing.id)).for("update");
        if (pending.status !== "PENDING") throw new ApiError(409, "This request has already been reviewed.");
        if (body.action === "reject") {
          await transaction.update(bookingRequests).set({ status: "REJECTED", reviewedAt: new Date() }).where(eq(bookingRequests.id, pending.id));
          return { status: "REJECTED" as const, booking: null };
        }
        await checkAvailability(transaction, pending);
        const [booking] = await transaction.insert(bookings).values({ name: pending.name, email: pending.email, bookingDate: pending.bookingDate, slotTime: pending.slotTime, endTime: pending.endTime }).returning();
        await transaction.update(bookingRequests).set({ status: "APPROVED", bookingId: booking.id, reviewedAt: new Date() }).where(eq(bookingRequests.id, pending.id));
        return { status: "APPROVED" as const, booking };
      });
      const emailSent = result.booking ? await sendConfirmationEmail(result.booking) : false;
      return json({ status: result.status, booking: result.booking ? serializeBooking(result.booking) : null, email_sent: emailSent });
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/booking-requests" };
